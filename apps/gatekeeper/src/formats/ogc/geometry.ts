import { isJsonNumber, isJsonObject, isJsonString, type JsonObject, type JsonValue } from "#/index";

/**
 * A single longitude/latitude pair standing for a whole geometry, so a boundary
 * can be put on a map without its outline. A point is itself, a line is its
 * length-weighted midpoint, a polygon its area centroid, and anything the
 * formulas cannot resolve (a degenerate ring, a collection of one point) falls
 * back to the mean of its positions.
 */
export function representativePoint(geometry: JsonObject | null): [number, number] | undefined {
  if (!geometry || !isJsonString(geometry.type)) return undefined;
  if (geometry.type === "GeometryCollection") return collectionPoint(geometry.geometries);
  const coordinates = geometry.coordinates;
  if (geometry.type === "Point") return position(coordinates);
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    const midpoint = lineMidpoint(coordinates);
    if (midpoint) return midpoint;
  }
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    const centroid = polygonCentroid(coordinates);
    if (centroid) return centroid;
  }
  return meanPosition(collectPositions(coordinates));
}

function collectionPoint(value: JsonValue | undefined): [number, number] | undefined {
  if (!Array.isArray(value)) return undefined;
  const points: Array<[number, number]> = [];
  for (const member of value) {
    const point = isJsonObject(member) ? representativePoint(member) : undefined;
    if (point) points.push(point);
  }
  return meanPosition(points);
}

function lineMidpoint(value: JsonValue | undefined): [number, number] | undefined {
  let weightedX = 0;
  let weightedY = 0;
  let length = 0;
  for (const [start, end] of segments(value)) {
    const span = Math.hypot(end[0] - start[0], end[1] - start[1]);
    weightedX += ((start[0] + end[0]) / 2) * span;
    weightedY += ((start[1] + end[1]) / 2) * span;
    length += span;
  }
  return length > 0 ? [weightedX / length, weightedY / length] : undefined;
}

function segments(value: JsonValue | undefined): Array<[[number, number], [number, number]]> {
  if (!Array.isArray(value)) return [];
  const points = value.map(position).filter((item) => item !== undefined);
  if (points.length === value.length && points.length >= 2) {
    const found: Array<[[number, number], [number, number]]> = [];
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      if (start && end) found.push([start, end]);
    }
    return found;
  }
  return value.flatMap(segments);
}

function polygonCentroid(value: JsonValue | undefined): [number, number] | undefined {
  let crossTotal = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (const ring of rings(value)) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      if (!start || !end) continue;
      const cross = start[0] * end[1] - end[0] * start[1];
      crossTotal += cross;
      weightedX += (start[0] + end[0]) * cross;
      weightedY += (start[1] + end[1]) * cross;
    }
  }
  if (Math.abs(crossTotal) < Number.EPSILON) return undefined;
  return [weightedX / (3 * crossTotal), weightedY / (3 * crossTotal)];
}

function rings(value: JsonValue | undefined): Array<Array<[number, number]>> {
  if (!Array.isArray(value)) return [];
  const positions = value.map(position).filter((item) => item !== undefined);
  if (positions.length === value.length && positions.length >= 4) return [positions];
  return value.flatMap(rings);
}

function collectPositions(value: JsonValue | undefined): Array<[number, number]> {
  const direct = position(value);
  if (direct) return [direct];
  if (!Array.isArray(value)) return [];
  return value.flatMap(collectPositions);
}

function meanPosition(positions: Array<[number, number]>): [number, number] | undefined {
  if (positions.length === 0) return undefined;
  let totalX = 0;
  let totalY = 0;
  for (const item of positions) {
    totalX += item[0];
    totalY += item[1];
  }
  return [totalX / positions.length, totalY / positions.length];
}

function position(value: JsonValue | undefined): [number, number] | undefined {
  if (!Array.isArray(value) || !isJsonNumber(value[0]) || !isJsonNumber(value[1]) || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    return undefined;
  }
  return [value[0], value[1]];
}

/**
 * How far a geometry reaches, as west, south, east, north in degrees. It is
 * what a feed publishes instead of an outline it is too large to carry: with
 * the representative point it says where a feature is and how much ground it
 * covers, which is enough to place it and to know what it might touch, without
 * the million coordinates of the ring itself.
 *
 * A geometry crossing the antimeridian is not stitched back together: the box
 * is taken from the positions as they are written, which is what any other
 * reader of the same feature sees.
 */
export function boundingBox(geometry: JsonObject | null): [number, number, number, number] | undefined {
  if (!geometry || !isJsonString(geometry.type)) return undefined;
  const positions = geometry.type === "GeometryCollection" ? collectionPositions(geometry.geometries) : collectPositions(geometry.coordinates);
  if (positions.length === 0) return undefined;
  let west = Infinity;
  let south = Infinity;
  let east = -Infinity;
  let north = -Infinity;
  for (const [x, y] of positions) {
    if (x < west) west = x;
    if (x > east) east = x;
    if (y < south) south = y;
    if (y > north) north = y;
  }
  if (west < -180 || east > 180 || south < -90 || north > 90) return undefined;
  return [west, south, east, north];
}

function collectionPositions(value: JsonValue | undefined): Array<[number, number]> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((member) => (isJsonObject(member) ? collectPositions(member.coordinates) : []));
}

/** Metres in a degree of latitude, and of longitude at the equator. */
const METRES_PER_DEGREE = 111_320;

/**
 * The geometry with every vertex dropped that lies within `metres` of the line
 * its neighbours draw (Douglas–Peucker, per line and per ring). A ring keeps
 * its closing position and never falls below four positions; one that would is
 * kept as written. Points are kept as they are. Distances are measured on a
 * local flat projection at each line's own latitude, which at these tolerances
 * is exact to well under a millimetre.
 */
export function simplifyGeometry(geometry: JsonObject, metres: number): JsonObject {
  const type = geometry.type;
  if (type === "GeometryCollection" && Array.isArray(geometry.geometries)) {
    return { ...geometry, geometries: geometry.geometries.map((member) => (isJsonObject(member) ? simplifyGeometry(member, metres) : member)) };
  }
  const coordinates = geometry.coordinates;
  if (!Array.isArray(coordinates)) return geometry;
  const line = (value: JsonValue): JsonValue => simplifyLine(value, metres, false);
  const ring = (value: JsonValue): JsonValue => simplifyLine(value, metres, true);
  const each = (value: JsonValue, inner: (member: JsonValue) => JsonValue): JsonValue => (Array.isArray(value) ? value.map(inner) : value);
  if (type === "LineString") return { ...geometry, coordinates: line(coordinates) };
  if (type === "MultiLineString" || type === "Polygon") return { ...geometry, coordinates: coordinates.map(type === "Polygon" ? ring : line) };
  if (type === "MultiPolygon") return { ...geometry, coordinates: coordinates.map((polygon) => each(polygon, ring)) };
  return geometry;
}

function simplifyLine(value: JsonValue, metres: number, closed: boolean): JsonValue {
  if (!Array.isArray(value) || value.length <= (closed ? 4 : 2)) return value;
  const points = value.map(position);
  if (points.some((point) => point === undefined)) return value;
  // SAFETY: every position was just checked to be defined.
  const xy = points as Array<[number, number]>;
  const scale = Math.cos((xy[0]![1] * Math.PI) / 180) * METRES_PER_DEGREE;
  const keep = new Uint8Array(xy.length);
  keep[0] = 1;
  keep[xy.length - 1] = 1;
  // An explicit stack: a boundary of two hundred thousand vertices would overflow a recursive one.
  const stack: Array<[number, number]> = [[0, xy.length - 1]];
  while (stack.length > 0) {
    const [first, last] = stack.pop()!;
    let farthest = -1;
    let distance = metres;
    for (let index = first + 1; index < last; index += 1) {
      const away = offLine(xy[index]!, xy[first]!, xy[last]!, scale);
      if (away > distance) {
        distance = away;
        farthest = index;
      }
    }
    if (farthest >= 0) {
      keep[farthest] = 1;
      stack.push([first, farthest], [farthest, last]);
    }
  }
  const kept = value.filter((_, index) => keep[index] === 1);
  return closed && kept.length < 4 ? value : kept;
}

/** How far `point` lies from the segment `from`–`to`, in metres. */
function offLine(point: [number, number], from: [number, number], to: [number, number], scale: number): number {
  const px = (point[0] - from[0]) * scale;
  const py = (point[1] - from[1]) * METRES_PER_DEGREE;
  const dx = (to[0] - from[0]) * scale;
  const dy = (to[1] - from[1]) * METRES_PER_DEGREE;
  const length = dx * dx + dy * dy;
  if (length === 0) return Math.hypot(px, py);
  const along = Math.max(0, Math.min(1, (px * dx + py * dy) / length));
  return Math.hypot(px - along * dx, py - along * dy);
}
