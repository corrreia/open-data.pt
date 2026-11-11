import Delaunator from "delaunator";
import * as THREE from "three";
import { sunPosition } from "../sun.ts";
import type { Terrain, Water } from "../terrain/format.ts";
import { Heights, Land, ORIGIN, type Point, project } from "../terrain/geometry.ts";
import { MapControls, type View } from "./controls.ts";

/**
 * The map every section draws on: mainland Portugal in relief, lit as the sun stands, with its
 * districts, rivers and lagoons. It knows nothing of weather. A section colours the land by a
 * value, and pins its own marks to places through `toScreen`.
 */

/** The scene's unit is the kilometre: x east, z south, y up. Heights are drawn this many times taller than they are. */
const EXAGGERATION = 7;
const metresToScene = (metres: number): number => (metres / 1000) * EXAGGERATION;
/** How far under the sea the shore's cliff reaches. */
const PLINTH = 3;
/** The spacing of the coarse grid of ground heights. */
const COARSE_KM = 3;

const SEA = 0xbfd6e2;
const INK = 0x1b2a33;

/** Hypsometric tints, metres to colour: the pale greens, straws and greys of a school atlas. */
const TINTS: [metres: number, colour: THREE.Color][] = [
  [0, new THREE.Color(0xa9c7a0)],
  [150, new THREE.Color(0xc4d6a4)],
  [400, new THREE.Color(0xe3dcae)],
  [800, new THREE.Color(0xdcc099)],
  [1300, new THREE.Color(0xc9ab95)],
  [2000, new THREE.Color(0xf4f1ea)],
];

function tint(metres: number, into: THREE.Color): THREE.Color {
  let below = TINTS[0] ?? [0, into];
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
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
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
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x8fa9b5, side: THREE.DoubleSide }));
}

/** Lines laid a little above the ground they cross, from runs of x, y, height. */
function draped(runs: Float32Array, lengths: readonly number[], lift: number, material: THREE.LineBasicMaterial): THREE.LineSegments {
  const positions: number[] = [];
  let offset = 0;
  for (const length of lengths) {
    for (let index = offset; index < offset + length - 1; index++) {
      for (const vertex of [index, index + 1]) positions.push(runs[vertex * 3] ?? 0, metresToScene(runs[vertex * 3 + 2] ?? 0) + lift, -(runs[vertex * 3 + 1] ?? 0));
    }
    offset += length;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return new THREE.LineSegments(geometry, material);
}

export interface MapScene {
  /** The box the mainland fits in, in kilometres of the plane. */
  bounds: { west: number; south: number; east: number; north: number };
  /** Whether a point of the plane is on the mainland. */
  onLand(point: Point): boolean;
  /** Where a place falls on the screen, in CSS pixels from the canvas's corner; nothing when it is out of sight. */
  toScreen(longitude: number, latitude: number): [x: number, y: number] | undefined;
  /** Called after the camera has moved, and once at the start. */
  onMove(listener: () => void): void;
  /** Colours the land by a value at each of its points, or back to its heights when given nothing. */
  paint(colourAt: ((point: Point, into: THREE.Color) => void) | undefined): void;
  /** Draws rivers and lagoons. */
  addWater(water: Water): void;
  /** Lights the map as the sun stands at this instant. */
  light(at: Date): void;
  /** Radians the view has turned clockwise from north. */
  bearing(): number;
  /** Turns the view back to north, looking straight down on the whole country. */
  home(): void;
}

export function createMap(canvas: HTMLCanvasElement, terrain: Terrain): MapScene {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SEA);

  const rings = ringsOf(terrain);
  const land = landMesh(terrain, rings);
  const borders = draped(terrain.borders, terrain.manifest.borders, 0.25, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.32, depthWrite: false }));
  const shore = new THREE.Group();
  for (const ring of rings) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        ring.flatMap((point) => [point[0], 0.05, -point[1]]),
        3,
      ),
    );
    shore.add(new THREE.LineLoop(geometry, new THREE.LineBasicMaterial({ color: INK, transparent: true, opacity: 0.55 })));
  }
  scene.add(land, plinth(terrain), borders, shore);

  const sky = new THREE.HemisphereLight(0xffffff, 0x8a8f8c, 1.5);
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(sky, sun, sun.target);

  const box = new THREE.Box3().setFromObject(land);
  const centre = box.getCenter(new THREE.Vector3()).setY(0);
  const span = box.getSize(new THREE.Vector3());
  sun.target.position.copy(centre);

  const camera = new THREE.PerspectiveCamera(30, 1, 1, 9000);
  /** Straight down on the whole country, north up: how a weather map is read. */
  const whole = (): View => {
    const tall = (span.z * 1.22) / (2 * Math.tan((camera.fov * Math.PI) / 360));
    const wide = (span.x * 1.25) / (2 * Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    return { x: centre.x, z: centre.z, distance: Math.max(tall, wide), bearing: 0, tilt: 0 };
  };

  const moved: (() => void)[] = [];
  let dirty = true;
  const resize = (): void => {
    const { clientWidth: width, clientHeight: height } = canvas;
    if (width === 0 || height === 0) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    dirty = true;
  };
  resize();
  const controls = new MapControls(camera, canvas, whole());
  // Until a hand has moved the map, it stays framed on the whole country however its box changes shape.
  let framed = true;
  for (const touch of ["pointerdown", "wheel"] as const) canvas.addEventListener(touch, () => (framed = false), { passive: true });
  new ResizeObserver(() => {
    resize();
    if (framed) controls.flyTo(whole(), 1);
  }).observe(canvas);

  const ground = new Heights(3);
  for (let index = 0; index < terrain.points.length; index += 3) ground.add([terrain.points[index] ?? 0, terrain.points[index + 1] ?? 0], terrain.points[index + 2] ?? 0);
  const onLand = new Land(rings);
  // Filled in as it is asked: most of the grid is sea and never is.
  const columns = Math.ceil(span.x / COARSE_KM) + 1;
  const rows = Math.ceil(span.z / COARSE_KM) + 1;
  const coarse = new Float32Array(columns * rows).fill(-1);
  const groundAt = (point: Point): number => {
    const column = Math.round((point[0] - box.min.x) / COARSE_KM);
    const row = Math.round((point[1] + box.max.z) / COARSE_KM);
    if (column < 0 || row < 0 || column >= columns || row >= rows || !onLand.has(point)) return 0;
    const cell = row * columns + column;
    const known = coarse[cell] ?? -1;
    if (known >= 0) return known;
    const height = metresToScene(ground.at(point, 3, 0.3));
    coarse[cell] = height;
    return height;
  };

  const corner = new THREE.Vector3();
  const colours = land.geometry.getAttribute("color");
  const colour = new THREE.Color();

  const map: MapScene = {
    bounds: { west: box.min.x, east: box.max.x, south: -box.max.z, north: -box.min.z },
    onLand: (point) => onLand.has(point),
    toScreen(longitude, latitude) {
      const point = project([longitude, latitude]);
      corner.set(point[0], groundAt(point), -point[1]).project(camera);
      if (corner.z > 1 || Math.abs(corner.x) > 1.05 || Math.abs(corner.y) > 1.05) return undefined;
      return [((corner.x + 1) / 2) * canvas.clientWidth, ((1 - corner.y) / 2) * canvas.clientHeight];
    },
    onMove: (listener) => void moved.push(listener),
    paint(colourAt) {
      for (let index = 0; index < terrain.points.length / 3; index++) {
        if (colourAt === undefined) tint(terrain.points[index * 3 + 2] ?? 0, colour);
        else colourAt([terrain.points[index * 3] ?? 0, terrain.points[index * 3 + 1] ?? 0], colour);
        colours.setXYZ(index, colour.r, colour.g, colour.b);
      }
      colours.needsUpdate = true;
      dirty = true;
    },
    addWater(water) {
      const lines: number[] = [];
      for (const river of water.rivers) {
        for (let index = 0; index < river.length - 1; index++) {
          for (const vertex of [river[index], river[index + 1]]) if (vertex !== undefined) lines.push(vertex[0], groundAt(vertex) + 0.18, -vertex[1]);
        }
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
      scene.add(new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: 0x3f84b8, transparent: true, opacity: 0.45 })));
      const sheet = new THREE.MeshBasicMaterial({ color: 0x6aa6cf, side: THREE.DoubleSide });
      for (const lagoon of water.lagoons) {
        const level = Math.max(...lagoon.map((point) => groundAt(point))) + 0.1;
        // The outline's own points triangulated, less the triangles that fall outside it where it bends inwards.
        const inside = new Land([lagoon], 0.2);
        const corners: number[] = [];
        const { triangles } = new Delaunator(lagoon.flat());
        for (let index = 0; index < triangles.length; index += 3) {
          const [a, b, c] = [lagoon[triangles[index] ?? 0], lagoon[triangles[index + 1] ?? 0], lagoon[triangles[index + 2] ?? 0]];
          if (a === undefined || b === undefined || c === undefined || !inside.has([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3])) continue;
          for (const each of [a, b, c]) corners.push(each[0], level, -each[1]);
        }
        const outline = new THREE.BufferGeometry();
        outline.setAttribute("position", new THREE.Float32BufferAttribute(corners, 3));
        scene.add(new THREE.Mesh(outline, sheet));
      }
      dirty = true;
    },
    light(at) {
      const { elevation, azimuth } = sunPosition(at, ORIGIN[0], ORIGIN[1]);
      // A map must stay readable at night: the light keeps the sun's side but never sinks low or dims far.
      const shown = Math.max(elevation, 38) * THREE.MathUtils.DEG2RAD;
      const bearing = azimuth * THREE.MathUtils.DEG2RAD;
      sun.position
        .set(Math.sin(bearing) * Math.cos(shown), Math.sin(shown), -Math.cos(bearing) * Math.cos(shown))
        .multiplyScalar(1000)
        .add(centre);
      dirty = true;
    },
    bearing: () => controls.goal.bearing,
    home() {
      // The shorter way round.
      controls.goal.bearing -= Math.round(controls.goal.bearing / (2 * Math.PI)) * 2 * Math.PI;
      controls.flyTo(whole(), 0.006);
      framed = true;
    },
  };

  let last = performance.now();
  const pose = new THREE.Matrix4();
  renderer.setAnimationLoop((now) => {
    controls.update(Math.min(100, now - last));
    last = now;
    // Nothing on this map moves by itself: a frame is drawn only when the view or the land has changed.
    if (!dirty && pose.equals(camera.matrixWorld)) return;
    pose.copy(camera.matrixWorld);
    dirty = false;
    renderer.render(scene, camera);
    for (const listener of moved) listener();
  });

  return map;
}
