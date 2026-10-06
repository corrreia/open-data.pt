import { asObject, asString, isJsonArray, isJsonNumber, parseJson, type CanonicalField, type CanonicalSchema, type JsonObject, type JsonValue } from "@open-data-pt/contract";

/**
 * Where a located product's rows are: a box per row, per chunk and per
 * product, the order rows are chunked in, and the exact test of one row
 * against a point. Everything here is plain arithmetic on WGS 84 degrees.
 */

/**
 * A longitude/latitude box in degrees. An object rather than a tuple: chunk
 * lists cross Durable Object RPC, whose types do not keep tuples.
 */
export interface Box {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** A box as GeoJSON and the API write one: `[west, south, east, north]`. */
export function bboxArray(box: Box): [number, number, number, number] {
  return [box.west, box.south, box.east, box.north];
}

/** The box an API `bbox` array names. */
export function boxOfArray([west, south, east, north]: readonly [number, number, number, number]): Box {
  return { west, south, east, north };
}

/** The fields a located product keeps its place in: a GeoJSON geometry, or a latitude/longitude pair. */
export interface Locator {
  geometry: CanonicalField | undefined;
  latitude: CanonicalField | undefined;
  longitude: CanonicalField | undefined;
}

/** How a product's rows are located, or undefined when its schema has no geometry and no coordinate pair. */
export function locatorFor(schema: CanonicalSchema): Locator | undefined {
  const geometry = schema.fields.find((field) => field.type === "geometry");
  const latitude = schema.fields.find((field) => field.type === "latitude");
  const longitude = schema.fields.find((field) => field.type === "longitude");
  if (!geometry && !(latitude && longitude)) return undefined;
  return { geometry, latitude, longitude };
}

/** A row's value for a field: rows carry each field under its name or, for some sources, its ID. */
function fieldValue(record: JsonObject, field: CanonicalField): JsonValue | undefined {
  return record[field.name] ?? record[field.id];
}

/** GeoJSON geometry types a row may carry. */
const GEOMETRY_TYPES = new Set(["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"]);

/**
 * Where one row is: its geometry, or a Point made of its latitude and longitude
 * when it has no geometry of its own, as the GeoJSON export reads it.
 */
export function rowGeometry(locator: Locator, record: JsonObject): JsonObject | undefined {
  if (locator.geometry) {
    const geometry = asObject(fieldValue(record, locator.geometry));
    const type = asString(geometry?.type);
    if (geometry && type && GEOMETRY_TYPES.has(type)) return geometry;
  }
  if (locator.latitude && locator.longitude) {
    const latitude = fieldValue(record, locator.latitude);
    const longitude = fieldValue(record, locator.longitude);
    if (isJsonNumber(latitude) && isJsonNumber(longitude) && Number.isFinite(latitude) && Number.isFinite(longitude)) return { type: "Point", coordinates: [longitude, latitude] };
  }
  return undefined;
}

/** The box one row covers, or undefined when it has no usable place. */
export function rowBox(locator: Locator, record: JsonObject): Box | undefined {
  const geometry = rowGeometry(locator, record);
  return geometry ? geometryBox(geometry) : undefined;
}

/** The box of a served row's JSON text; parsed only for a located product. */
export function rowJsonBox(locator: Locator, json: string): Box | undefined {
  const record = asObject(parseJson(json));
  return record ? rowBox(locator, record) : undefined;
}

/** The box of every position in a GeoJSON geometry, or undefined when it holds none. */
export function geometryBox(geometry: JsonObject): Box | undefined {
  const box: Box = { west: Infinity, south: Infinity, east: -Infinity, north: -Infinity };
  const visit = (value: JsonValue | undefined): void => {
    if (!isJsonArray(value)) return;
    const [x, y] = value;
    if (isJsonNumber(x) && isJsonNumber(y)) {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      if (x < box.west) box.west = x;
      if (y < box.south) box.south = y;
      if (x > box.east) box.east = x;
      if (y > box.north) box.north = y;
      return;
    }
    for (const item of value) visit(item);
  };
  const walk = (node: JsonObject): void => {
    if (asString(node.type) === "GeometryCollection") {
      for (const member of isJsonArray(node.geometries) ? node.geometries : []) {
        const child = asObject(member);
        if (child) walk(child);
      }
      return;
    }
    visit(node.coordinates);
  };
  walk(geometry);
  return Number.isFinite(box.west) ? box : undefined;
}

/**
 * The smallest box around every box given, widened outwards to the sixth
 * decimal (about 11 cm), so a chunk list stays short and a box never shrinks
 * past what it holds. Null when no box was given: a chunk of rows that have
 * no place is still indexed, and is never read for a point.
 */
export function unionBox(boxes: Iterable<Box | null | undefined>): Box | null {
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const item of boxes) {
    if (!item) continue;
    west = Math.min(west, item.west);
    south = Math.min(south, item.south);
    east = Math.max(east, item.east);
    north = Math.max(north, item.north);
  }
  if (!Number.isFinite(west)) return null;
  return { west: down(west), south: down(south), east: up(east), north: up(north) };
}

/**
 * A coordinate to the sixth decimal, never above it. Scaling by a million can
 * round away a difference in the last bit, so the result is checked against
 * the coordinate itself and moved one step further when it came out inside.
 */
function down(value: number): number {
  const rounded = Math.floor(value * 1e6) / 1e6;
  return rounded > value ? rounded - 1e-6 : rounded;
}

/** A coordinate to the sixth decimal, never below it. */
function up(value: number): number {
  const rounded = Math.ceil(value * 1e6) / 1e6;
  return rounded < value ? rounded + 1e-6 : rounded;
}

/* ---------- Spatial order ---------- */

/**
 * The extent the Hilbert curve is laid over: mainland Portugal, Madeira and
 * the Azores, with room around them. A place outside it is clamped to its
 * edge, which only costs locality, never correctness.
 */
const ORDER_EXTENT: Box = { west: -32, south: 29, east: -6, north: 43 };
/** Cells per side: 2^16 over 26° by 14° is about 40 by 24 metres in the mainland. */
const ORDER_BITS = 16;

/** The distance along a Hilbert curve of the cell holding a point: nearby cells are near on the curve. */
export function hilbertIndex(longitude: number, latitude: number): number {
  const side = 1 << ORDER_BITS;
  const cell = (value: number, low: number, high: number) => Math.max(0, Math.min(side - 1, Math.floor(((value - low) / (high - low)) * side)));
  let x = cell(longitude, ORDER_EXTENT.west, ORDER_EXTENT.east);
  let y = cell(latitude, ORDER_EXTENT.south, ORDER_EXTENT.north);
  let distance = 0;
  for (let half = side >> 1; half > 0; half >>= 1) {
    const right = (x & half) > 0 ? 1 : 0;
    const top = (y & half) > 0 ? 1 : 0;
    distance += half * half * ((3 * right) ^ top);
    if (top === 0) {
      if (right === 1) {
        x = half - 1 - x;
        y = half - 1 - y;
      }
      [x, y] = [y, x];
    }
  }
  return distance;
}

/**
 * The key a located product's rows are chunked in: the Hilbert index of the
 * centre of the row's box, then its entity key, so rows near each other land
 * in the same chunks and every chunk covers a small box. Rows with no place
 * sort last, together. Plain ASCII, so JavaScript and SQLite order it alike.
 */
export function spatialOrderKey(box: Box | undefined, entityKey: string): string {
  if (!box) return `~:${entityKey}`;
  const index = hilbertIndex((box.west + box.east) / 2, (box.south + box.north) / 2);
  return `${index.toString(16).padStart(8, "0")}:${entityKey}`;
}

/* ---------- A point and what is at it ---------- */

/** Metres in a degree of latitude, on a sphere of the Earth's mean radius. */
const METRES_PER_DEGREE = (6_371_008.8 * Math.PI) / 180;

/** A point asked about, and how far around it to look for points and lines, in metres. */
export interface PointQuery {
  longitude: number;
  latitude: number;
  radius: number;
}

/**
 * The box a query has to intersect: the point widened by the radius, with a
 * little to spare for the flat-earth arithmetic below. A row or a chunk whose
 * box misses it cannot match.
 */
export function queryBox(query: PointQuery): Box {
  const latitudeDegrees = (query.radius / METRES_PER_DEGREE) * 1.01;
  const longitudeDegrees = latitudeDegrees / Math.max(0.01, Math.cos((query.latitude * Math.PI) / 180));
  return {
    west: query.longitude - longitudeDegrees,
    south: query.latitude - latitudeDegrees,
    east: query.longitude + longitudeDegrees,
    north: query.latitude + latitudeDegrees,
  };
}

export function boxesIntersect(a: Box, b: Box): boolean {
  return a.west <= b.east && b.west <= a.east && a.south <= b.north && b.south <= a.north;
}

/** How a row stands to the point: inside one of its polygons, or this many metres from its nearest point or line. */
export interface Hit {
  inside: boolean;
  /** Metres; 0 inside a polygon. */
  distance: number;
}

/**
 * Whether a row's geometry covers the point: a polygon (holes excluded) that
 * contains it, or a point or line within the radius. A polygon the point lies
 * outside does not match, however near its edge; the radius is for things
 * that have no inside. Distances use a local equirectangular projection
 * around the point, well within a metre at the radii this answers.
 */
export function hitTest(geometry: JsonObject, query: PointQuery): Hit | undefined {
  const measured = measure(geometry, new Plane(query));
  if (!measured) return undefined;
  if (measured.inside) return { inside: true, distance: 0 };
  return measured.distance <= query.radius ? { inside: false, distance: measured.distance } : undefined;
}

/** Positions in metres east and north of the query point. */
class Plane {
  private readonly east: number;

  constructor(readonly query: PointQuery) {
    this.east = METRES_PER_DEGREE * Math.cos((query.latitude * Math.PI) / 180);
  }

  x(longitude: number): number {
    return (longitude - this.query.longitude) * this.east;
  }

  y(latitude: number): number {
    return (latitude - this.query.latitude) * METRES_PER_DEGREE;
  }
}

function position(value: JsonValue | undefined): [number, number] | undefined {
  if (!isJsonArray(value)) return undefined;
  const [x, y] = value;
  return isJsonNumber(x) && isJsonNumber(y) && Number.isFinite(x) && Number.isFinite(y) ? [x, y] : undefined;
}

function list(value: JsonValue | undefined): JsonValue[] {
  return isJsonArray(value) ? value : [];
}

/** The nearest of two measurements, an inside one first. */
function nearer(a: Hit | undefined, b: Hit | undefined): Hit | undefined {
  if (!a) return b;
  if (!b) return a;
  if (a.inside || b.inside) return { inside: true, distance: 0 };
  return a.distance <= b.distance ? a : b;
}

function measure(geometry: JsonObject, plane: Plane): Hit | undefined {
  const coordinates = geometry.coordinates;
  switch (asString(geometry.type)) {
    case "Point":
      return pointDistance(position(coordinates), plane);
    case "MultiPoint":
      return list(coordinates).reduce<Hit | undefined>((best, item) => nearer(best, pointDistance(position(item), plane)), undefined);
    case "LineString":
      return lineDistance(list(coordinates), plane);
    case "MultiLineString":
      return list(coordinates).reduce<Hit | undefined>((best, item) => nearer(best, lineDistance(list(item), plane)), undefined);
    case "Polygon":
      return polygonContains(list(coordinates), plane.query) ? { inside: true, distance: 0 } : undefined;
    case "MultiPolygon":
      return list(coordinates).some((polygon) => polygonContains(list(polygon), plane.query)) ? { inside: true, distance: 0 } : undefined;
    case "GeometryCollection":
      return list(geometry.geometries).reduce<Hit | undefined>((best, item) => {
        const member = asObject(item);
        return member ? nearer(best, measure(member, plane)) : best;
      }, undefined);
    default:
      return undefined;
  }
}

function pointDistance(point: [number, number] | undefined, plane: Plane): Hit | undefined {
  if (!point) return undefined;
  return { inside: false, distance: Math.hypot(plane.x(point[0]), plane.y(point[1])) };
}

/** The distance from the query point (the plane's origin) to the nearest segment of a line. */
function lineDistance(line: JsonValue[], plane: Plane): Hit | undefined {
  let best: number | undefined;
  let previous: [number, number] | undefined;
  for (const item of line) {
    const point = position(item);
    if (!point) continue;
    const current: [number, number] = [plane.x(point[0]), plane.y(point[1])];
    const distance = previous ? segmentDistance(previous, current) : Math.hypot(current[0], current[1]);
    if (best === undefined || distance < best) best = distance;
    previous = current;
  }
  return best === undefined ? undefined : { inside: false, distance: best };
}

function segmentDistance(a: [number, number], b: [number, number]): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / length));
  return Math.hypot(a[0] + t * dx, a[1] + t * dy);
}

/**
 * Even-odd ray casting over every ring of a polygon at once: the point is
 * inside when a ray from it crosses the rings an odd number of times, so a
 * point in a hole crosses the outer ring and the hole's and is outside.
 */
function polygonContains(rings: JsonValue[], query: PointQuery): boolean {
  const x = query.longitude;
  const y = query.latitude;
  let inside = false;
  for (const ring of rings) {
    const points = list(ring);
    let previous = position(points.at(-1));
    for (const item of points) {
      const current = position(item);
      if (!current) continue;
      if (previous && current[1] > y !== previous[1] > y) {
        const crossing = ((previous[0] - current[0]) * (y - current[1])) / (previous[1] - current[1]) + current[0];
        if (x < crossing) inside = !inside;
      }
      previous = current;
    }
  }
  return inside;
}
