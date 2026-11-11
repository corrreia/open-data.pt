import * as THREE from "three";
import type { Station } from "./data.ts";
import type { Layer } from "./layers.ts";
import type { MapScene } from "./scene.ts";
import { type Point, project } from "./terrain/geometry.ts";

/**
 * Wind as a flow you can read from above: thousands of motes carried over the land the way the
 * wind at the stations says the air is moving, each leaving a short trail. Where they run fast
 * and long the wind is strong; where they crawl it is calm; the way they go is the way it blows.
 *
 * The field between stations is this site's guess: each station's wind as an arrow, and at every
 * point the nearby arrows averaged by distance. It knows nothing of mountains or the sea.
 */

const CELL_KM = 6;
const MOTES = 2600;
/** Positions a mote remembers, which is how long its trail is. */
const TRAIL = 10;
/** Kilometres of map a mote covers in a second for each km/h of wind: far faster than the air, or nothing would be seen to move. */
const PACE = 0.55;
const LIFE_MS = 5200;

/** Kilometres an hour to colour: calm is a dim teal, a gale burns pink. */
const SPEED_COLOURS: [speed: number, colour: THREE.Color][] = [
  [0, new THREE.Color(0x1d6f8a)],
  [12, new THREE.Color(0x4fe3ff)],
  [30, new THREE.Color(0xf4fbff)],
  [50, new THREE.Color(0xffc44d)],
  [80, new THREE.Color(0xff3d8b)],
];

function speedColour(speed: number, into: THREE.Color): THREE.Color {
  let below = SPEED_COLOURS[0] ?? [0, into];
  for (const above of SPEED_COLOURS) {
    if (speed <= above[0]) return into.lerpColors(below[1], above[1], above[0] === below[0] ? 0 : (speed - below[0]) / (above[0] - below[0]));
    below = above;
  }
  return into.copy(below[1]);
}

/** Whether enough stations say where their wind blows from to draw a flow at all. */
export function knowsDirections(stations: readonly Station[]): boolean {
  return stations.filter((station) => station.windFrom !== undefined && station.windSpeed !== undefined).length >= 8;
}

export function windFlowLayer(map: MapScene, stations: readonly Station[], bounds: { west: number; south: number; east: number; north: number }): Layer {
  // Each station's wind as the east and north parts of where the air is going, in km/h.
  const arrows = stations.flatMap((station) => {
    if (station.windFrom === undefined || station.windSpeed === undefined) return [];
    const to = ((station.windFrom + 180) * Math.PI) / 180;
    return [{ point: project([station.longitude, station.latitude]), east: Math.sin(to) * station.windSpeed, north: Math.cos(to) * station.windSpeed }];
  });

  const columns = Math.ceil((bounds.east - bounds.west) / CELL_KM) + 1;
  const rows = Math.ceil((bounds.north - bounds.south) / CELL_KM) + 1;
  const east = new Float32Array(columns * rows);
  const north = new Float32Array(columns * rows);
  const ground = new Float32Array(columns * rows);
  const land = new Uint8Array(columns * rows);
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const point: Point = [bounds.west + column * CELL_KM, bounds.south + row * CELL_KM];
      let weights = 0;
      let sumEast = 0;
      let sumNorth = 0;
      for (const arrow of arrows) {
        const weight = 1 / ((arrow.point[0] - point[0]) ** 2 + (arrow.point[1] - point[1]) ** 2 + 400);
        weights += weight * weight;
        sumEast += arrow.east * weight * weight;
        sumNorth += arrow.north * weight * weight;
      }
      const cell = row * columns + column;
      east[cell] = weights === 0 ? 0 : sumEast / weights;
      north[cell] = weights === 0 ? 0 : sumNorth / weights;
      land[cell] = map.onLand(point) ? 1 : 0;
      ground[cell] = land[cell] === 1 ? map.ground(point) : 0;
    }
  }
  /** A grid's value at a point, blended from the four cells around it. */
  const sample = (grid: Float32Array, x: number, y: number): number => {
    const column = THREE.MathUtils.clamp((x - bounds.west) / CELL_KM, 0, columns - 1.001);
    const row = THREE.MathUtils.clamp((y - bounds.south) / CELL_KM, 0, rows - 1.001);
    const c = Math.floor(column);
    const r = Math.floor(row);
    const cell = r * columns + c;
    const top = (grid[cell] ?? 0) + ((grid[cell + 1] ?? 0) - (grid[cell] ?? 0)) * (column - c);
    const bottom = (grid[cell + columns] ?? 0) + ((grid[cell + columns + 1] ?? 0) - (grid[cell + columns] ?? 0)) * (column - c);
    return top + (bottom - top) * (row - r);
  };
  const overLand = (x: number, y: number): boolean => land[Math.round((y - bounds.south) / CELL_KM) * columns + Math.round((x - bounds.west) / CELL_KM)] === 1;

  // Every mote is TRAIL points; the trail is drawn as the segments between them, fading to nothing at the tail.
  const trail = new Float32Array(MOTES * TRAIL * 2);
  const born = new Float32Array(MOTES);
  const positions = new Float32Array(MOTES * (TRAIL - 1) * 6);
  const colours = new Float32Array(MOTES * (TRAIL - 1) * 6);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
  const lines = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  lines.frustumCulled = false;
  lines.renderOrder = 4;
  map.scene.add(lines);

  const spawn = (mote: number, now: number): void => {
    let x = 0;
    let y = 0;
    for (let attempt = 0; attempt < 30; attempt++) {
      x = bounds.west + Math.random() * (bounds.east - bounds.west);
      y = bounds.south + Math.random() * (bounds.north - bounds.south);
      if (overLand(x, y)) break;
    }
    for (let point = 0; point < TRAIL; point++) trail.set([x, y], (mote * TRAIL + point) * 2);
    born[mote] = now - Math.random() * LIFE_MS * 0.4;
  };

  const colour = new THREE.Color();
  let last = 0;
  let started = false;
  map.onFrame((now) => {
    if (!lines.visible) return;
    if (!started) {
      // Born at scattered ages, so they do not all die and return together.
      for (let mote = 0; mote < MOTES; mote++) {
        spawn(mote, now);
        born[mote] = now - Math.random() * LIFE_MS;
      }
      started = true;
      last = now;
    }
    const seconds = Math.min(0.05, (now - last) / 1000);
    last = now;
    for (let mote = 0; mote < MOTES; mote++) {
      const head = mote * TRAIL * 2;
      const x = trail[head] ?? 0;
      const y = trail[head + 1] ?? 0;
      const age = now - (born[mote] ?? 0);
      if (age > LIFE_MS || !overLand(x, y)) {
        spawn(mote, now);
        continue;
      }
      const blowsEast = sample(east, x, y);
      const blowsNorth = sample(north, x, y);
      const speed = Math.hypot(blowsEast, blowsNorth);
      trail.copyWithin(head + 2, head, head + (TRAIL - 1) * 2);
      trail[head] = x + blowsEast * PACE * seconds;
      trail[head + 1] = y + blowsNorth * PACE * seconds;

      speedColour(speed, colour);
      // Fades in as it is born and out as it dies.
      const life = Math.min(1, age / 500) * Math.min(1, (LIFE_MS - age) / 900);
      for (let segment = 0; segment < TRAIL - 1; segment++) {
        const from = head + segment * 2;
        const out = (mote * (TRAIL - 1) + segment) * 6;
        for (let end = 0; end < 2; end++) {
          const px = trail[from + end * 2] ?? 0;
          const py = trail[from + end * 2 + 1] ?? 0;
          positions[out + end * 3] = px;
          positions[out + end * 3 + 1] = sample(ground, px, py) + 0.5;
          positions[out + end * 3 + 2] = -py;
          const glow = life * (1 - (segment + end) / TRAIL) ** 1.6;
          colours[out + end * 3] = colour.r * glow;
          colours[out + end * 3 + 1] = colour.g * glow;
          colours[out + end * 3 + 2] = colour.b * glow;
        }
      }
    }
    geometry.getAttribute("position").needsUpdate = true;
    geometry.getAttribute("color").needsUpdate = true;
  });

  return { show: (visible) => void (lines.visible = visible), spots: () => [] };
}
