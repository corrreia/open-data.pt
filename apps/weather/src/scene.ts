import Delaunator from "delaunator";
import * as THREE from "three";
import { MapControls } from "./controls.ts";
import type { Terrain } from "./terrain/format.ts";
import { Heights, Land, ORIGIN, type Point, project, unproject } from "./terrain/geometry.ts";
import { sunPosition } from "./sun.ts";

/** The scene's unit is the kilometre: x east, z south, y up. Heights are drawn this many times taller than they are. */
export const EXAGGERATION = 9;
export const metresToScene = (metres: number): number => (metres / 1000) * EXAGGERATION;
/** How far under the sea the shore's cliff reaches. */
const PLINTH = 5;
/** The spacing of the coarse grid of ground heights. */
const COARSE_KM = 3;

/** The Atlantic as a chart prints it: a deep ink, not the black of a screen. */
const NIGHT = new THREE.Color(0x0f2a33);
const SEA = new THREE.Color(0x12303a);
/** The colour of the chart's own lines and lettering. */
const PAPER = 0xe9e4d4;

/** Hypsometric tints, metres to colour: lowland green through dry upland to bare summit. */
const TINTS: [metres: number, colour: THREE.Color][] = [
  [0, new THREE.Color(0x5f7f66)],
  [150, new THREE.Color(0x86a074)],
  [400, new THREE.Color(0xc2bd85)],
  [800, new THREE.Color(0xc9a274)],
  [1300, new THREE.Color(0xb98f78)],
  [2000, new THREE.Color(0xf1ece0)],
];

function tint(metres: number, into: THREE.Color): THREE.Color {
  let below = TINTS[0] ?? [0, NIGHT];
  for (const above of TINTS) {
    if (metres <= above[0]) return into.lerpColors(below[1], above[1], above[0] === below[0] ? 0 : (metres - below[0]) / (above[0] - below[0]));
    below = above;
  }
  return into.copy(below[1]);
}

function ringsOf(terrain: Terrain): Point[][] {
  const rings: Point[][] = [];
  let offset = 0;
  for (const length of terrain.manifest.rings) {
    const ring: Point[] = [];
    for (let index = offset; index < offset + length; index++) ring.push([terrain.points[index * 3] ?? 0, terrain.points[index * 3 + 1] ?? 0]);
    rings.push(ring);
    offset += length;
  }
  return rings;
}

/** The land: every point triangulated, and the triangles that fell in the sea thrown away. */
function landMesh(terrain: Terrain, rings: Point[][]): THREE.Mesh {
  const count = terrain.points.length / 3;
  const flat = new Float64Array(count * 2);
  const positions = new Float32Array(count * 3);
  const colours = new Float32Array(count * 3);
  const colour = new THREE.Color();
  for (let index = 0; index < count; index++) {
    const x = terrain.points[index * 3] ?? 0;
    const y = terrain.points[index * 3 + 1] ?? 0;
    const metres = terrain.points[index * 3 + 2] ?? 0;
    flat.set([x, y], index * 2);
    positions.set([x, metresToScene(metres), -y], index * 3);
    tint(metres, colour).toArray(colours, index * 3);
  }

  const land = new Land(rings);
  const { triangles } = new Delaunator(flat);
  const kept: number[] = [];
  for (let index = 0; index < triangles.length; index += 3) {
    const a = triangles[index] ?? 0;
    const b = triangles[index + 1] ?? 0;
    const c = triangles[index + 2] ?? 0;
    const centre: Point = [((flat[a * 2] ?? 0) + (flat[b * 2] ?? 0) + (flat[c * 2] ?? 0)) / 3, ((flat[a * 2 + 1] ?? 0) + (flat[b * 2 + 1] ?? 0) + (flat[c * 2 + 1] ?? 0)) / 3];
    // Delaunator winds its triangles the other way up once north becomes -z.
    if (land.has(centre)) kept.push(a, c, b);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  geometry.setIndex(kept);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, metalness: 0 });
  // Contour lines every hundred metres, drawn in the shader from the height each fragment stands at.
  material.onBeforeCompile = (shader) => {
    shader.uniforms["metresPerUnit"] = { value: 1000 / EXAGGERATION };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vHeight;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvHeight = position.y;");
    shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying float vHeight;\nuniform float metresPerUnit;").replace(
      "#include <color_fragment>",
      `#include <color_fragment>
        float contour = vHeight * metresPerUnit / 100.0;
        float onContour = 1.0 - clamp(abs(fract(contour - 0.5) - 0.5) / fwidth(contour), 0.0, 1.0);
        diffuseColor.rgb *= 1.0 - onContour * 0.2;`,
    );
  };
  return new THREE.Mesh(geometry, material);
}

/** The shore and the frontier, drawn as a chart draws a coast. */
function outline(rings: Point[][]): THREE.Group {
  const group = new THREE.Group();
  for (const ring of rings) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        ring.flatMap((point) => [point[0], 0.06, -point[1]]),
        3,
      ),
    );
    group.add(new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.75, depthWrite: false })));
  }
  return group;
}

/** The cliff under the shore and the frontier, so the country stands on the sea as a cut block. */
function plinth(terrain: Terrain): THREE.Mesh {
  const positions: number[] = [];
  let offset = 0;
  for (const length of terrain.manifest.rings) {
    for (let index = 0; index < length; index++) {
      const from = (offset + index) * 3;
      const to = (offset + ((index + 1) % length)) * 3;
      const [ax, ay, ah, bx, by, bh] = [
        terrain.points[from] ?? 0,
        terrain.points[from + 1] ?? 0,
        terrain.points[from + 2] ?? 0,
        terrain.points[to] ?? 0,
        terrain.points[to + 1] ?? 0,
        terrain.points[to + 2] ?? 0,
      ];
      positions.push(ax, metresToScene(ah), -ay, bx, metresToScene(bh), -by, ax, -PLINTH, -ay, bx, metresToScene(bh), -by, bx, -PLINTH, -by, ax, -PLINTH, -ay);
    }
    offset += length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color: 0x0a2028, roughness: 1, side: THREE.DoubleSide }));
}

/** District borders, laid a little above the ground they cross. */
function borders(terrain: Terrain): THREE.LineSegments {
  const positions: number[] = [];
  let offset = 0;
  for (const length of terrain.manifest.borders) {
    for (let index = offset; index < offset + length - 1; index++) {
      for (const vertex of [index, index + 1]) {
        positions.push(terrain.borders[vertex * 3] ?? 0, metresToScene(terrain.borders[vertex * 3 + 2] ?? 0) + 0.35, -(terrain.borders[vertex * 3 + 1] ?? 0));
      }
    }
    offset += length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x0b2129, transparent: true, opacity: 0.35, depthWrite: false }));
}

/** A few characters lying on the sea, lettered as on a chart's margin, about twenty kilometres tall. */
function lettering(text: string, at: Point): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const pen = canvas.getContext("2d");
  if (pen !== null) {
    pen.font = "500 40px 'B612 Mono', ui-monospace, monospace";
    pen.textAlign = "center";
    pen.textBaseline = "middle";
    pen.fillStyle = "#e9e4d4";
    pen.fillText(text, 128, 34);
  }
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(56, 14),
    new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, opacity: 0.5, depthWrite: false }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(at[0], 0.02, -at[1]);
  return mesh;
}

/** The sea, with a line at every degree of latitude and longitude. */
function sea(): THREE.Group {
  const group = new THREE.Group();
  const water = new THREE.Mesh(new THREE.CircleGeometry(4000, 64), new THREE.MeshBasicMaterial({ color: SEA }));
  water.rotation.x = -Math.PI / 2;
  water.position.y = -0.05;
  group.add(water);

  const positions: number[] = [];
  const corner = (longitude: number, latitude: number): void => {
    const [x, y] = project([longitude, latitude]);
    positions.push(x, 0, -y);
  };
  for (let longitude = -32; longitude <= 4; longitude++) {
    corner(longitude, 28);
    corner(longitude, 50);
  }
  for (let latitude = 28; latitude <= 50; latitude++) {
    corner(-32, latitude);
    corner(4, latitude);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  group.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: PAPER, transparent: true, opacity: 0.13 })));

  // Each line named where it leaves the land for the sea: parallels down the west, meridians along the south.
  for (let latitude = 37; latitude <= 42; latitude++) group.add(lettering(`${latitude}° N`, project([-10.45, latitude])));
  for (let longitude = -9; longitude <= -7; longitude++) group.add(lettering(`${-longitude}° W`, project([longitude, 36.55])));
  return group;
}

export interface Reading {
  longitude: number;
  latitude: number;
  metres: number;
}

/** What a layer draws with: the scene, the ground under any point, and a turn on every frame. */
export interface MapScene {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  /** The box the mainland fits in, in kilometres of the plane. */
  bounds: { west: number; south: number; east: number; north: number };
  /** Whether a point of the plane is on the mainland. */
  onLand(point: Point): boolean;
  /** How high the drawn ground stands at a point of the plane, in the scene's units. */
  ground(point: Point): number;
  /** The same, read from a coarse grid: for what asks thousands of times a frame and can be a little off. */
  groundFast(point: Point): number;
  /** Where a point of the plane at a height of the scene falls on the screen, in CSS pixels; nothing when it is behind the camera. */
  toScreen(point: Point, height: number): [x: number, y: number] | undefined;
  /** Called before every frame is drawn, with the time in milliseconds. */
  onFrame(listener: (now: number) => void): void;
  /** Colours the land by a value at each of its points, or back to its heights when given nothing. */
  paint(colourAt: ((point: Point, into: THREE.Color) => void) | undefined): void;
  /** What the pointer is over, or nothing when it is over the sea. */
  onReading: (reading: Reading | undefined) => void;
  /** Lights the map as the sun stands at this instant, and says how high it stands. */
  light(at: Date): number;
  /** Radians the view has turned clockwise from north. */
  bearing(): number;
  /** Turns the view back to north, looking straight down. */
  faceNorth(): void;
}

export function createMap(canvas: HTMLCanvasElement, terrain: Terrain): MapScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = NIGHT;
  scene.fog = new THREE.Fog(NIGHT, 1400, 4200);

  const rings = ringsOf(terrain);
  const land = landMesh(terrain, rings);
  scene.add(land, plinth(terrain), borders(terrain), outline(rings), sea());

  const sky = new THREE.HemisphereLight(0xe6edf0, 0x3a4a4c, 0.9);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  scene.add(sky, sun, sun.target);

  // The middle of the mainland, by its outline's bounds.
  const box = new THREE.Box3().setFromObject(land);
  const centre = box.getCenter(new THREE.Vector3()).setY(0);
  const span = box.getSize(new THREE.Vector3());

  const camera = new THREE.PerspectiveCamera(36, 1, 1, 8000);
  // Opens from straight above, far off, and settles into a leaning view from the south.
  const far = { x: centre.x, z: centre.z, distance: span.z * 3.4, bearing: 0, tilt: 0 };
  const rest = { x: centre.x, z: centre.z + span.z * 0.04, distance: span.z * 1.72, bearing: 0.32, tilt: 0.78 };
  const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const controls = new MapControls(camera, canvas, still ? rest : far);
  if (!still) controls.flyTo(rest, 0.0014);

  const resize = (): void => {
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    camera.aspect = window.innerWidth / window.innerHeight;
    // The legend covers a margin of the window: the middle of the view is the middle of what is left.
    const wide = window.innerWidth > 700;
    camera.setViewOffset(window.innerWidth, window.innerHeight, wide ? -134 : 0, wide ? 0 : 37, window.innerWidth, window.innerHeight);
    // A phone held upright sees the country whole only from farther back.
    camera.fov = camera.aspect < 0.8 ? 52 : 36;
    camera.updateProjectionMatrix();
  };
  window.addEventListener("resize", resize);
  resize();

  const ground = new Heights(3);
  for (let index = 0; index < terrain.points.length; index += 3) ground.add([terrain.points[index] ?? 0, terrain.points[index + 1] ?? 0], terrain.points[index + 2] ?? 0);
  const onLand = new Land(rings);
  const listeners: ((now: number) => void)[] = [];
  // Filled in as it is asked: most of the grid is sea and never is.
  const columns = Math.ceil(span.x / COARSE_KM) + 1;
  const rows = Math.ceil(span.z / COARSE_KM) + 1;
  const coarse = new Float32Array(columns * rows).fill(-1);
  const corner = new THREE.Vector3();
  const colours = land.geometry.getAttribute("color");
  const colour = new THREE.Color();

  const map: MapScene = {
    scene,
    camera,
    bounds: { west: box.min.x, east: box.max.x, south: -box.max.z, north: -box.min.z },
    onLand: (point) => onLand.has(point),
    ground: (point) => metresToScene(ground.at(point, 3, 0.3)),
    groundFast(point) {
      const column = Math.round((point[0] - box.min.x) / COARSE_KM);
      const row = Math.round((point[1] + box.max.z) / COARSE_KM);
      if (column < 0 || row < 0 || column >= columns || row >= rows) return 0;
      const cell = row * columns + column;
      const known = coarse[cell] ?? -1;
      if (known >= 0) return known;
      const height = metresToScene(ground.at([box.min.x + column * COARSE_KM, -box.max.z + row * COARSE_KM], 3, 0.3));
      coarse[cell] = height;
      return height;
    },
    toScreen(point, height) {
      corner.set(point[0], height, -point[1]).project(camera);
      return corner.z > 1 ? undefined : [((corner.x + 1) / 2) * window.innerWidth, ((1 - corner.y) / 2) * window.innerHeight];
    },
    onFrame: (listener) => void listeners.push(listener),
    paint(colourAt) {
      for (let index = 0; index < terrain.points.length / 3; index++) {
        if (colourAt === undefined) tint(terrain.points[index * 3 + 2] ?? 0, colour);
        else colourAt([terrain.points[index * 3] ?? 0, terrain.points[index * 3 + 1] ?? 0], colour);
        colours.setXYZ(index, colour.r, colour.g, colour.b);
      }
      colours.needsUpdate = true;
    },
    onReading: () => {},
    bearing: () => controls.goal.bearing,
    faceNorth() {
      // The shorter way round.
      controls.goal.bearing -= Math.round(controls.goal.bearing / (2 * Math.PI)) * 2 * Math.PI;
      controls.flyTo({ ...controls.goal, bearing: 0, tilt: 0 }, 0.006);
    },
    light(at) {
      const { elevation, azimuth } = sunPosition(at, ORIGIN[0], ORIGIN[1]);
      // 0 in the dark, 1 in full day, easing through twilight.
      const day = THREE.MathUtils.smoothstep(elevation, -8, 10);
      // Below a low angle the light would skim the relief flat, and at night there would be none: the moon stands in.
      const shown = Math.max(elevation, 14) * THREE.MathUtils.DEG2RAD;
      const bearing = azimuth * THREE.MathUtils.DEG2RAD;
      sun.position
        .set(Math.sin(bearing) * Math.cos(shown), Math.sin(shown), -Math.cos(bearing) * Math.cos(shown))
        .multiplyScalar(1000)
        .add(centre);
      sun.target.position.copy(centre);
      sun.color.lerpColors(new THREE.Color(0x6f8fd8), new THREE.Color(elevation < 12 ? 0xffc58a : 0xfff4e2), day);
      sun.intensity = THREE.MathUtils.lerp(1.1, 2.3, day);
      sky.intensity = THREE.MathUtils.lerp(0.75, 1.15, day);
      return elevation;
    },
  };

  const pointer = new THREE.Vector2();
  let pointerMoved = false;
  canvas.addEventListener("pointermove", (event) => {
    pointer.set((event.clientX / window.innerWidth) * 2 - 1, -(event.clientY / window.innerHeight) * 2 + 1);
    pointerMoved = event.buttons === 0;
  });
  canvas.addEventListener("pointerleave", () => map.onReading(undefined));
  const ray = new THREE.Raycaster();
  const read = (): void => {
    pointerMoved = false;
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObject(land)[0];
    if (hit === undefined) return map.onReading(undefined);
    const [longitude, latitude] = unproject([hit.point.x, -hit.point.z]);
    map.onReading({ longitude, latitude, metres: (hit.point.y / EXAGGERATION) * 1000 });
  };

  let last = performance.now();
  renderer.setAnimationLoop((now) => {
    controls.update(Math.min(100, now - last));
    last = now;
    for (const listener of listeners) listener(now);
    if (pointerMoved) read();
    renderer.render(scene, camera);
  });

  return map;
}
