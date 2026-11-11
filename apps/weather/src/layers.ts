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
  [-5, 0x2f4b7c],
  [4, 0x5d8fb3],
  [11, 0xa9c9c0],
  [17, 0xe9e0b8],
  [23, 0xe8b76a],
  [30, 0xd9743f],
  [38, 0xa8322d],
  [44, 0x5e1a2b],
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
    new THREE.MeshStandardMaterial({ color: 0xe9e4d4, transparent: true, opacity: 0.3, roughness: 0.4, depthWrite: false }),
    placed.length,
  );
  const water = new THREE.InstancedMesh(cylinder, new THREE.MeshStandardMaterial({ color: 0x2f7fc2, roughness: 0.4 }), placed.length);
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
  const rivers = new THREE.LineSegments(riverGeometry, new THREE.LineBasicMaterial({ color: 0x1f6aa8, transparent: true, opacity: 0.5 }));

  const group = new THREE.Group();
  group.add(rivers);
  const sheet = new THREE.MeshBasicMaterial({ color: 0x2f7fc2, side: THREE.DoubleSide });
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
 * Things happening at places, each a ring with a dot at its middle, in its kind's colour, the way
 * a chart marks a spot. What matters more among its kind is drawn larger. They keep their size on
 * the screen, so one incident can be found from over the whole country. `size` is how large a kind
 * is drawn against the others, and `filled` whether the ring is a disc: a warning covers an area,
 * an incident is at a point.
 */
export function happeningLayer(map: MapScene, happenings: readonly Happening[], size: number, filled: boolean): Layer {
  const placed = onTheMainland(map, happenings);
  const flat = { transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide };
  const rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.78, 1, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ ...flat, opacity: 0.95 }), placed.length);
  const middles = new THREE.InstancedMesh(
    new THREE.CircleGeometry(filled ? 0.78 : 0.3, 24).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ ...flat, opacity: filled ? 0.28 : 0.95 }),
    placed.length,
  );
  const colour = new THREE.Color();
  placed.forEach((happening, index) => {
    rings.setColorAt(index, colour.setHex(happening.thing.colour));
    middles.setColorAt(index, colour);
  });
  for (const mesh of [rings, middles]) {
    mesh.frustumCulled = false;
    mesh.renderOrder = filled ? 3 : 5;
  }
  const group = new THREE.Group();
  group.add(middles, rings);
  map.scene.add(group);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const upright = new THREE.Quaternion();
  const stretch = new THREE.Vector3();
  map.onFrame(() => {
    if (!group.visible) return;
    placed.forEach((happening, index) => {
      position.set(happening.point[0], happening.ground + 0.2, -happening.point[1]);
      const scale = Math.max(0.3, position.distanceTo(map.camera.position) * 0.0045) * size * (0.6 + happening.thing.weight * 0.9);
      matrix.compose(position, upright, stretch.setScalar(scale));
      rings.setMatrixAt(index, matrix);
      middles.setMatrixAt(index, matrix);
    });
    rings.instanceMatrix.needsUpdate = true;
    middles.instanceMatrix.needsUpdate = true;
  });

  return {
    show: (visible) => void (group.visible = visible),
    spots: () => placed.map((happening) => ({ point: happening.point, height: happening.ground, label: happening.thing.label })),
  };
}
