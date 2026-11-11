/**
 * Bakes the terrain the page opens on, from open-data.pt and nothing else: `pnpm --filter @open-data-pt/weather bake`.
 *
 * There is no elevation model on open-data.pt, so the relief is drawn from what is: the shore and
 * the frontier from DGT's boundary segments (CAOP), at sea level, and the height of the land from
 * DGT's geodetic vertices and principal summits. Those marks stand on high ground, so valleys come
 * out shallower than they are; the page says so. The products change about once a year, and their
 * segments alone are 70 MB, so the result is checked in under `public/` rather than read on every visit.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TerrainManifest, TerrainSource } from "./src/terrain/format.ts";
import { densify, Heights, Land, type Point, project, signedArea, simplify, stitchRings } from "./src/terrain/geometry.ts";

const API = "https://open-data.pt/api/products";

const GRID_KM = 1;
const SHORE_KM = 0.1;
const SHORE_SPACING_KM = 0.5;
const BORDER_KM = 0.15;
/** A grid point this close to the shore would make slivers against it. */
const SHORE_CLEARANCE_KM = 0.35;
/** Rocks and islets smaller than this are left to the sea. */
const SMALLEST_RING_KM2 = 0.5;
const STEP_KM = 0.01;
const STEP_METRES = 0.1;

interface Row {
  geometry?: { type: string; coordinates: never };
  latitude?: number;
  longitude?: number;
  ea_direita?: string;
  ea_esquerda?: string;
  H_topo_?: string;
  Altitude_m?: number;
}

async function read(product: string): Promise<{ rows: Row[]; source: TerrainSource }> {
  const [about, records] = await Promise.all([fetch(`${API}/${product}`), fetch(`${API}/${product}/records/all`)]);
  if (!about.ok || !records.ok) throw new Error(`${product}: ${about.status} ${records.status}`);
  // SAFETY: the two answers are open-data.pt's product and record-list shapes, of which these are the fields read.
  const { title, attribution, licence } = (await about.json()) as { title: string; attribution: string; licence: { name: string } };
  // SAFETY: as above.
  const { data } = (await records.json()) as { data: Row[] };
  return { rows: data, source: { product, title, attribution, licence: licence.name, rows: data.length } };
}

function linesOf(row: Row): Point[][] {
  const geometry = row.geometry;
  if (geometry === undefined) return [];
  // SAFETY: GeoJSON says a LineString holds positions and a MultiLineString holds lists of them.
  const lines =
    geometry.type === "LineString" ? [geometry.coordinates as [number, number][]] : geometry.type === "MultiLineString" ? (geometry.coordinates as [number, number][][]) : [];
  return lines.map((line) => line.map((position) => project(position)));
}

const segments = await read("dgt-caop-trocos");
const vertices = await read("dgt-rgn-vertices-geodesicos");
const summits = await read("dgt-serras-cumes-principais");

// A segment names the parish on either side of it by its six-digit code. On the outline of the mainland
// one side is no parish: CAOP writes 99 for the ocean, 97 for other water (Lisbon's bank of the Tagus) and 98 for Spain.
const outside = (row: Row): string | undefined => [row.ea_direita, row.ea_esquerda].find((side) => side?.length !== 6);
const edge = segments.rows.filter((row) => outside(row) !== undefined).flatMap(linesOf);
const shoreLines = segments.rows.filter((row) => outside(row) === "99" || outside(row) === "97").flatMap(linesOf);
const rings = stitchRings(edge, 0.001)
  .filter((ring) => Math.abs(signedArea(ring)) >= SMALLEST_RING_KM2)
  .toSorted((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))
  .map((ring) => densify(simplify([...ring, ring[0] ?? [0, 0]], SHORE_KM).slice(0, -1), SHORE_SPACING_KM, true));
const mainland = rings[0];
if (mainland === undefined || Math.abs(signedArea(mainland)) < 80_000) throw new Error("the coast and frontier segments no longer close around the mainland");
const land = new Land(rings);

// The frontier is land: only the shore is at sea level.
const shore = new Heights(2);
for (const line of shoreLines) for (const point of densify(line, SHORE_SPACING_KM, false)) shore.add(point, 0);

const heights = new Heights();
for (const line of shoreLines) for (const point of densify(simplify(line, SHORE_KM), 1, false)) heights.add(point, 0);
for (const row of vertices.rows) {
  const metres = Number(row.H_topo_);
  if (row.longitude !== undefined && row.latitude !== undefined && Number.isFinite(metres)) heights.add(project([row.longitude, row.latitude]), metres);
}
for (const row of summits.rows) {
  if (row.longitude !== undefined && row.latitude !== undefined && row.Altitude_m !== undefined) heights.add(project([row.longitude, row.latitude]), row.Altitude_m);
}

/** Whether a ring point is on the shore rather than the frontier: a shore sample lies within reach of it. */
function onShore(point: Point): boolean {
  return shore.near(point, SHORE_SPACING_KM * 1.5);
}

const points: number[] = [];
for (const ring of rings) for (const point of ring) points.push(point[0], point[1], onShore(point) ? 0 : heights.at(point));

const xs = mainland.map((point) => point[0]);
const ys = mainland.map((point) => point[1]);
const west = Math.floor(Math.min(...xs)) - 1;
const south = Math.floor(Math.min(...ys)) - 1;
const east = Math.ceil(Math.max(...xs)) + 1;
const north = Math.ceil(Math.max(...ys)) + 1;
// A triangular lattice: rows offset by half a step, so the mesh has no grain.
const rowKm = (GRID_KM * Math.sqrt(3)) / 2;
for (let row = 0, y = south; y <= north; row++, y = south + row * rowKm) {
  for (let x = west + (row % 2) * (GRID_KM / 2); x <= east; x += GRID_KM) {
    const point: Point = [x, y];
    if (land.has(point) && !shore.near(point, SHORE_CLEARANCE_KM)) points.push(x, y, Math.max(0.5, heights.at(point)));
  }
}

const district = (parish: string | undefined): string => (parish ?? "").slice(0, 2);
const borderLines = segments.rows
  .filter((row) => outside(row) === undefined && district(row.ea_direita) !== district(row.ea_esquerda))
  .flatMap(linesOf)
  .map((line) => densify(simplify(line, BORDER_KM), 1, false));
const borders: number[] = [];
for (const line of borderLines) for (const point of line) borders.push(point[0], point[1], heights.at(point));

const stored = new Uint16Array(points.length + borders.length);
[...points, ...borders].forEach((value, index) => {
  const quantized = index % 3 === 0 ? (value - west) / STEP_KM : index % 3 === 1 ? (value - south) / STEP_KM : value / STEP_METRES;
  stored[index] = Math.max(0, Math.min(65_535, Math.round(quantized)));
});

const manifest: TerrainManifest = {
  bakedAt: new Date().toISOString(),
  west,
  south,
  stepKm: STEP_KM,
  stepMetres: STEP_METRES,
  points: points.length / 3,
  rings: rings.map((ring) => ring.length),
  borders: borderLines.map((line) => line.length),
  sources: [segments.source, vertices.source, summits.source],
};
const target = resolve(import.meta.dirname, "public");
writeFileSync(resolve(target, "terrain.bin"), stored);
writeFileSync(resolve(target, "terrain.json"), `${JSON.stringify(manifest)}\n`);
console.log(`${manifest.points} points, ${rings.length} rings, ${borderLines.length} border lines, ${stored.byteLength} bytes`);
