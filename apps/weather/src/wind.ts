import * as THREE from "three";
import type { Station } from "./data.ts";
import type { Layer } from "./layers.ts";
import type { MapScene } from "./scene.ts";
import { type Point, project } from "./terrain/geometry.ts";

/**
 * Wind as arrows laid over the country, the way a weather chart draws it: each points where the
 * air is going and is as long as the wind is strong. They drift along their own heading, so the
 * eye reads the flow without having to study a single one.
 *
 * Between stations the wind is this site's reckoning: each station's wind as an arrow, and at
 * every point the nearby arrows averaged by distance. It knows nothing of mountains or the sea.
 */

/** Kilometres between one arrow and the next. */
const SPACING_KM = 21;
/** The wind an arrow of full length stands for, in km/h; a stronger one is drawn no longer. */
export const FULL_LENGTH_KMH = 60;
const LONGEST_KM = 22;
const SHORTEST_KM = 8;
/** How long an arrow takes to drift from where it appears to where it fades, in milliseconds. */
const DRIFT_MS = 3200;

/** Whether enough stations say where their wind blows from to draw the wind at all. */
export function knowsDirections(stations: readonly Station[]): boolean {
  return stations.filter((station) => station.windFrom !== undefined && station.windSpeed !== undefined).length >= 8;
}

/** An arrow one unit long lying on the ground, pointing north: a shaft and a head. */
function arrow(): THREE.BufferGeometry {
  const outline = [
    [-0.06, 0],
    [0.06, 0],
    [0.06, 0.62],
    [-0.06, 0.62],
    [-0.2, 0.58],
    [0.2, 0.58],
    [0, 1],
  ];
  const positions = outline.flatMap(([x = 0, y = 0]) => [x, 0, -y]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3, 4, 5, 6]);
  return geometry;
}

interface Placed {
  point: Point;
  /** Radians clockwise from north the air is heading. */
  heading: number;
  speed: number;
  /** Where in its drift this arrow starts, so they do not all move as one. */
  phase: number;
}

export function windArrowLayer(map: MapScene, stations: readonly Station[]): Layer {
  // Each station's wind as the east and north parts of where the air is going, in km/h.
  const readings = stations.flatMap((station) => {
    if (station.windFrom === undefined || station.windSpeed === undefined) return [];
    const to = ((station.windFrom + 180) * Math.PI) / 180;
    return [{ point: project([station.longitude, station.latitude]), east: Math.sin(to) * station.windSpeed, north: Math.cos(to) * station.windSpeed }];
  });

  const placed: Placed[] = [];
  const { west, east, south, north } = map.bounds;
  for (let row = 0, y = south; y <= north; row++, y += SPACING_KM * 0.866) {
    for (let x = west + (row % 2) * (SPACING_KM / 2); x <= east; x += SPACING_KM) {
      const point: Point = [x, y];
      if (!map.onLand(point)) continue;
      let weights = 0;
      let blowsEast = 0;
      let blowsNorth = 0;
      for (const reading of readings) {
        const weight = 1 / ((reading.point[0] - x) ** 2 + (reading.point[1] - y) ** 2 + 300) ** 2;
        weights += weight;
        blowsEast += reading.east * weight;
        blowsNorth += reading.north * weight;
      }
      if (weights === 0) continue;
      const speed = Math.hypot(blowsEast, blowsNorth) / weights;
      // Still air has no heading worth an arrow.
      if (speed < 1.5) continue;
      placed.push({ point, heading: Math.atan2(blowsEast, blowsNorth), speed, phase: (Math.sin(x * 12.9898 + y * 78.233) * 43_758.5453) % 1 });
    }
  }

  const material = new THREE.MeshBasicMaterial({ color: 0x0b2129, side: THREE.DoubleSide, depthTest: false, transparent: true, opacity: 0.92 });
  const arrows = new THREE.InstancedMesh(arrow(), material, placed.length);
  arrows.frustumCulled = false;
  arrows.renderOrder = 4;
  map.scene.add(arrows);

  const matrix = new THREE.Matrix4();
  const position = new THREE.Vector3();
  const turned = new THREE.Quaternion();
  const size = new THREE.Vector3();
  const upright = new THREE.Vector3(0, 1, 0);
  map.onFrame((now) => {
    if (!arrows.visible) return;
    placed.forEach((each, index) => {
      const length = SHORTEST_KM + (LONGEST_KM - SHORTEST_KM) * Math.min(1, each.speed / FULL_LENGTH_KMH);
      // 0 as it appears, 1 as it goes: it grows in, slides its own length forward, and shrinks away.
      const drift = (now / DRIFT_MS + Math.abs(each.phase)) % 1;
      const shown = Math.sin(Math.PI * drift) ** 0.6;
      const along = (drift - 0.5) * length;
      const x = each.point[0] + Math.sin(each.heading) * along;
      const y = each.point[1] + Math.cos(each.heading) * along;
      position.set(x, map.groundFast([x, y]) + 0.9, -y);
      turned.setFromAxisAngle(upright, -each.heading);
      arrows.setMatrixAt(index, matrix.compose(position, turned, size.set(length * shown, 1, length * shown)));
    });
    arrows.instanceMatrix.needsUpdate = true;
  });

  return { show: (visible) => void (arrows.visible = visible), spots: () => [] };
}
