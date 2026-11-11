import Delaunator from "delaunator";
import * as THREE from "three";
import type { Happening, Reservoir, Station } from "./data.ts";
import type { MapScene } from "./scene.ts";
import type { Water } from "./terrain/format.ts";
import { Heights, Land, type Point, project } from "./terrain/geometry.ts";

/** Something on the map the pointer can rest on, and what to say about it. */
export interface Spot {
  point: Point;
  /** The height of the scene the spot is drawn at. */
  height: number;
  label: string;
}

export interface Layer {
  show(visible: boolean): void;
  spots(): Spot[];
}

/** Air temperature, degrees Celsius to colour. */
export const TEMPERATURE_SCALE: [degrees: number, colour: number][] = [
  [-5, 0x3b2f8f],
  [0, 0x3466c2],
  [8, 0x39a7c9],
  [14, 0x6cc08b],
  [20, 0xf0d35a],
  [27, 0xef8a3a],
  [34, 0xd43d3d],
  [42, 0x7a1238],
];

function scaled(scale: readonly [value: number, colour: number][], value: number, into: THREE.Color): THREE.Color {
  let below = scale[0] ?? [0, 0];
  for (const above of scale) {
    if (value <= above[0]) return into.setHex(below[1]).lerp(new THREE.Color(above[1]), above[0] === below[0] ? 0 : (value - below[0]) / (above[0] - below[0]));
    below = above;
  }
  return into.setHex(below[1]);
}

const NUMBER = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });
const HOUR = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", hour: "2-digit", minute: "2-digit" });
const DAY = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

interface Placed<Thing> {
  thing: Thing;
  point: Point;
  ground: number;
}

function onTheMainland<Thing extends { longitude: number; latitude: number }>(map: MapScene, things: readonly Thing[]): Placed<Thing>[] {
  return things.flatMap((thing) => {
    const point = project([thing.longitude, thing.latitude]);
    return map.onLand(point) ? [{ thing, point, ground: map.ground(point) }] : [];
  });
}

/**
 * The land coloured by air temperature: at every point, the nearest stations' readings weighted by
 * distance. It is a picture of the readings, not a forecast model: it knows nothing of altitude or the sea.
 */
export function temperatureLayer(map: MapScene, stations: readonly Station[]): Layer {
  const placed = onTheMainland(map, stations).filter((station) => station.thing.temperature !== undefined);
  const field = new Heights(40);
  for (const station of placed) field.add(station.point, station.thing.temperature ?? 0);
  return {
    show(visible) {
      map.paint(visible && placed.length > 0 ? (point, into) => void scaled(TEMPERATURE_SCALE, field.at(point, 6, 12), into) : undefined);
    },
    spots: () =>
      placed.map((station) => ({
        point: station.point,
        height: station.ground,
        label: `${station.thing.name}\n${NUMBER.format(station.thing.temperature ?? 0)} °C${station.thing.humidity === undefined ? "" : ` · ${NUMBER.format(station.thing.humidity)} % humidade`}\nIPMA, ${HOUR.format(station.thing.observedAt)}`,
      })),
  };
}

const COMPASS_NAMES = ["norte", "nordeste", "leste", "sueste", "sul", "sudoeste", "oeste", "noroeste"];

function windLabel(station: Station): string {
  const from = station.windFrom === undefined ? "" : ` de ${COMPASS_NAMES[Math.round(station.windFrom / 45) % 8] ?? ""}`;
  return `${station.name}\nvento${from} a ${NUMBER.format(station.windSpeed ?? 0)} km/h\nIPMA, ${HOUR.format(station.observedAt)}`;
}

/** Where each station measures the wind, for the pointer to ask: the flow itself is drawn elsewhere. */
export function windReadings(map: MapScene, stations: readonly Station[]): Spot[] {
  return onTheMainland(map, stations)
    .filter((station) => station.thing.windSpeed !== undefined)
    .map((station) => ({ point: station.point, height: station.ground, label: windLabel(station.thing) }));
}

/** An anemometer's rotor: three arms with a cup at the end of each, turning about the upright axis. */
function rotor(): THREE.BufferGeometry {
  const positions: number[] = [];
  const quad = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, d: THREE.Vector3): void => {
    for (const corner of [a, b, c, a, c, d]) positions.push(corner.x, corner.y, corner.z);
  };
  for (let arm = 0; arm < 3; arm++) {
    const turn = new THREE.Matrix4().makeRotationY((arm * 2 * Math.PI) / 3);
    const at = (x: number, y: number, z: number): THREE.Vector3 => new THREE.Vector3(x, y, z).applyMatrix4(turn);
    quad(at(0, 0, -0.06), at(0.8, 0, -0.06), at(0.8, 0, 0.06), at(0, 0, 0.06));
    quad(at(0.72, -0.2, 0), at(1.12, -0.2, 0), at(1.12, 0.2, 0), at(0.72, 0.2, 0));
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

/** Kilometres an hour to colour: calm is pale, a gale is hot. */
const WIND_SCALE: [speed: number, colour: number][] = [
  [0, 0x9fb4cc],
  [15, 0xffffff],
  [40, 0xffd166],
  [75, 0xff5d8f],
];

/**
 * Wind as the instrument that measures it: an anemometer over each station, turning as fast as the
 * wind there blows. The product carries speed alone, so nothing here pretends to a direction.
 */
export function windLayer(map: MapScene, stations: readonly Station[]): Layer {
  const placed = onTheMainland(map, stations).filter((station) => station.thing.windSpeed !== undefined);
  const material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, transparent: true, opacity: 0.95, depthTest: false });
  const rotors = new THREE.InstancedMesh(rotor(), material, placed.length);
  rotors.renderOrder = 3;
  rotors.frustumCulled = false;
  const masts: number[] = [];
  const colour = new THREE.Color();
  placed.forEach((station, index) => {
    rotors.setColorAt(index, scaled(WIND_SCALE, station.thing.windSpeed ?? 0, colour));
    masts.push(station.point[0], station.ground, -station.point[1], station.point[0], station.ground + 1, -station.point[1]);
  });
  const mastGeometry = new THREE.BufferGeometry();
  mastGeometry.setAttribute("position", new THREE.Float32BufferAttribute(masts, 3));
  const mastLines = new THREE.LineSegments(mastGeometry, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, depthTest: false }));
  mastLines.renderOrder = 3;
  mastLines.frustumCulled = false;
  const group = new THREE.Group();
  group.add(rotors, mastLines);
  map.scene.add(group);

  // The instruments keep their size on the screen: on the ground they would be specks from above and towers up close.
  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const spin = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const upright = new THREE.Vector3(0, 1, 0);
  const mast = mastGeometry.getAttribute("position");
  const heights = placed.map(() => 0);
  map.onFrame((now) => {
    if (!group.visible) return;
    placed.forEach((station, index) => {
      position.set(station.point[0], station.ground, -station.point[1]);
      const scale = Math.max(0.25, position.distanceTo(map.camera.position) * 0.0032);
      const top = station.ground + scale * 1.6;
      heights[index] = top;
      // A full turn a second at about 60 km/h; still air barely creeps.
      spin.setFromAxisAngle(upright, (now / 1000) * (0.15 + (station.thing.windSpeed ?? 0) / 10) + index);
      matrix.compose(position.setY(top), spin, size.setScalar(scale));
      rotors.setMatrixAt(index, matrix);
      mast.setY(index * 2 + 1, top);
    });
    rotors.instanceMatrix.needsUpdate = true;
    mast.needsUpdate = true;
  });

  return {
    show: (visible) => void (group.visible = visible),
    spots: () =>
      placed.map((station, index) => ({
        point: station.point,
        height: heights[index] ?? station.ground,
        label: windLabel(station.thing),
      })),
  };
}

const TANK_HEIGHT = 5;

/**
 * Each reservoir as a glass standing where its dam is: as wide as it is large, and filled as far
 * as it is full. The widest, Alqueva, holds more than the next ten together.
 */
export function reservoirLayer(map: MapScene, reservoirs: readonly Reservoir[]): Layer {
  const placed = onTheMainland(map, reservoirs);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 40, 1, false).translate(0, 0.5, 0);
  const glass = new THREE.InstancedMesh(
    cylinder,
    new THREE.MeshStandardMaterial({ color: 0xcfe6ff, transparent: true, opacity: 0.24, roughness: 0.2, depthWrite: false }),
    placed.length,
  );
  const water = new THREE.InstancedMesh(cylinder, new THREE.MeshStandardMaterial({ color: 0x2f8fe8, emissive: 0x0b3a78, emissiveIntensity: 0.6, roughness: 0.25 }), placed.length);
  const matrix = new THREE.Matrix4();
  const upright = new THREE.Quaternion();
  const fullness = (reservoir: Reservoir): number | undefined =>
    reservoir.storedHm3 === undefined ? undefined : Math.max(0, Math.min(1, reservoir.storedHm3 / reservoir.capacityHm3));
  placed.forEach((reservoir, index) => {
    // Area on the map in proportion to capacity, so a glass twice as wide holds four times as much.
    const radius = 0.3 + Math.sqrt(reservoir.thing.capacityHm3) * 0.07;
    const base = new THREE.Vector3(reservoir.point[0], reservoir.ground, -reservoir.point[1]);
    glass.setMatrixAt(index, matrix.compose(base, upright, new THREE.Vector3(radius, TANK_HEIGHT, radius)));
    water.setMatrixAt(index, matrix.compose(base, upright, new THREE.Vector3(radius * 0.94, Math.max(0.05, TANK_HEIGHT * (fullness(reservoir.thing) ?? 0)), radius * 0.94)));
  });
  glass.renderOrder = 2;
  const group = new THREE.Group();
  group.add(water, glass);
  map.scene.add(group);

  return {
    show: (visible) => void (group.visible = visible),
    spots: () =>
      placed.map((reservoir) => {
        const full = fullness(reservoir.thing);
        const reading =
          full === undefined || reservoir.thing.storedHm3 === undefined || reservoir.thing.readAt === undefined
            ? "sem leitura recente"
            : `${Math.round(full * 100)} % · ${NUMBER.format(reservoir.thing.storedHm3)} de ${NUMBER.format(reservoir.thing.capacityHm3)} hm³\nAPA, ${DAY.format(reservoir.thing.readAt)}`;
        return {
          point: reservoir.point,
          height: reservoir.ground + TANK_HEIGHT * (full ?? 0.5),
          label: `Albufeira de ${reservoir.thing.name}\nbacia do ${reservoir.thing.basin}\n${reading}`,
        };
      }),
  };
}

/** Rivers laid along the ground they run over, and lagoons as sheets of water where they lie. */
export function waterLayer(map: MapScene, water: Water): Layer {
  const lines: number[] = [];
  for (const river of water.rivers) {
    const heights = river.map((point) => map.ground(point) + 0.22);
    for (let index = 0; index < river.length - 1; index++) {
      for (const vertex of [index, index + 1]) lines.push(river[vertex]?.[0] ?? 0, heights[vertex] ?? 0, -(river[vertex]?.[1] ?? 0));
    }
  }
  const riverGeometry = new THREE.BufferGeometry();
  riverGeometry.setAttribute("position", new THREE.Float32BufferAttribute(lines, 3));
  const rivers = new THREE.LineSegments(riverGeometry, new THREE.LineBasicMaterial({ color: 0x2f9bff, transparent: true, opacity: 0.55 }));

  const group = new THREE.Group();
  group.add(rivers);
  const sheet = new THREE.MeshStandardMaterial({ color: 0x3aa0f0, emissive: 0x0b3a78, emissiveIntensity: 0.5, roughness: 0.2, side: THREE.DoubleSide });
  for (const lagoon of water.lagoons) {
    const level = Math.max(...lagoon.map((point) => map.ground(point))) + 0.12;
    // The outline's own points triangulated, less the triangles that fall outside it where it bends inwards.
    const inside = new Land([lagoon], 0.2);
    const corners: number[] = [];
    const { triangles } = new Delaunator(lagoon.flat());
    for (let index = 0; index < triangles.length; index += 3) {
      const [a, b, c] = [lagoon[triangles[index] ?? 0], lagoon[triangles[index + 1] ?? 0], lagoon[triangles[index + 2] ?? 0]];
      if (a === undefined || b === undefined || c === undefined || !inside.has([(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3])) continue;
      for (const corner of [a, b, c]) corners.push(corner[0], level, -corner[1]);
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(corners, 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, sheet);
    group.add(mesh);
  }
  map.scene.add(group);
  return { show: (visible) => void (group.visible = visible), spots: () => [] };
}

/**
 * Things happening at places, each a ring of light on the ground with a beam standing in it. The
 * ring breathes; what matters more among its kind stands taller and wider. They keep their size
 * on the screen, so one incident can be found from over the whole country. `size` is how large a
 * kind is drawn against the others, and `beams` whether its weightier ones stand a beam in their ring.
 */
export function happeningLayer(map: MapScene, happenings: readonly Happening[], size: number, beams: boolean): Layer {
  const placed = onTheMainland(map, happenings);
  const ring = new THREE.RingGeometry(0.72, 1, 40).rotateX(-Math.PI / 2);
  const beam = new THREE.CylinderGeometry(0.05, 0.16, 1, 8, 1, true).translate(0, 0.5, 0);
  const glow = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false, side: THREE.DoubleSide };
  const rings = new THREE.InstancedMesh(ring, new THREE.MeshBasicMaterial({ ...glow, opacity: 0.8 }), placed.length);
  const shafts = new THREE.InstancedMesh(beam, new THREE.MeshBasicMaterial({ ...glow, opacity: 0.4 }), placed.length);
  const colour = new THREE.Color();
  placed.forEach((happening, index) => {
    rings.setColorAt(index, colour.setHex(happening.thing.colour));
    shafts.setColorAt(index, colour);
  });
  for (const mesh of [rings, shafts]) {
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
  }
  const group = new THREE.Group();
  group.add(rings, shafts);
  map.scene.add(group);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const upright = new THREE.Quaternion();
  const stretch = new THREE.Vector3();
  map.onFrame((now) => {
    if (!group.visible) return;
    placed.forEach((happening, index) => {
      position.set(happening.point[0], happening.ground + 0.15, -happening.point[1]);
      const scale = Math.max(0.35, position.distanceTo(map.camera.position) * 0.0045) * size * (0.6 + happening.thing.weight * 0.9);
      const breath = 1 + 0.22 * Math.sin(now / 420 + index * 1.7);
      rings.setMatrixAt(index, matrix.compose(position, upright, stretch.setScalar(scale * breath)));
      // A beam of no height is no beam: the lighter ones keep to their ring.
      const tall = beams && happening.thing.weight > 0.3 ? scale * (2 + happening.thing.weight * 5) : 0;
      shafts.setMatrixAt(index, matrix.compose(position, upright, stretch.set(scale, tall, scale)));
    });
    rings.instanceMatrix.needsUpdate = true;
    shafts.instanceMatrix.needsUpdate = true;
  });

  return {
    show: (visible) => void (group.visible = visible),
    spots: () => placed.map((happening) => ({ point: happening.point, height: happening.ground, label: happening.thing.label })),
  };
}
