/**
 * The plane the map is drawn on: kilometres east and north of a fixed origin. An equirectangular
 * projection about the middle of mainland Portugal is within a few hundred metres of true over the
 * whole country, which is finer than the terrain it carries.
 */

export type Point = readonly [x: number, y: number];
export type Position = readonly [longitude: number, latitude: number];

export const ORIGIN: Position = [-7.85, 39.55];

const KM_PER_DEGREE_LATITUDE = 110.95;
const KM_PER_DEGREE_LONGITUDE = 111.32 * Math.cos((ORIGIN[1] * Math.PI) / 180);

export function project(position: Position): Point {
  return [(position[0] - ORIGIN[0]) * KM_PER_DEGREE_LONGITUDE, (position[1] - ORIGIN[1]) * KM_PER_DEGREE_LATITUDE];
}

export function unproject(point: Point): Position {
  return [point[0] / KM_PER_DEGREE_LONGITUDE + ORIGIN[0], point[1] / KM_PER_DEGREE_LATITUDE + ORIGIN[1]];
}

/** Lines that share endpoints, joined end to end into closed rings. Lines that never close are left out. */
export function stitchRings(lines: readonly (readonly Point[])[], toleranceKm: number): Point[][] {
  const key = (point: Point): string => `${Math.round(point[0] / toleranceKm)},${Math.round(point[1] / toleranceKm)}`;
  const ends = new Map<string, number[]>();
  lines.forEach((line, index) => {
    const first = line[0];
    const last = line.at(-1);
    if (first === undefined || last === undefined || line.length < 2) return;
    for (const end of [first, last]) {
      const at = key(end);
      ends.set(at, [...(ends.get(at) ?? []), index]);
    }
  });

  const used = new Set<number>();
  const rings: Point[][] = [];
  lines.forEach((start, startIndex) => {
    const origin = start[0];
    if (used.has(startIndex) || origin === undefined || start.length < 2) return;
    used.add(startIndex);
    const ring: Point[] = [...start];
    const closesAt = key(origin);
    for (;;) {
      const tail = ring.at(-1);
      if (tail === undefined) return;
      const at = key(tail);
      if (at === closesAt && ring.length > 3) {
        ring.pop();
        rings.push(ring);
        return;
      }
      const next = (ends.get(at) ?? []).find((index) => !used.has(index));
      const line = next === undefined ? undefined : lines[next];
      if (next === undefined || line === undefined) return;
      used.add(next);
      const first = line[0];
      const forwards = first !== undefined && key(first) === at;
      ring.push(...(forwards ? line.slice(1) : line.toReversed().slice(1)));
    }
  });
  return rings;
}

/** Twice the signed area of a ring; positive when it runs anticlockwise. */
export function signedArea(ring: readonly Point[]): number {
  let sum = 0;
  ring.forEach((point, index) => {
    const next = ring[(index + 1) % ring.length] ?? point;
    sum += point[0] * next[1] - next[0] * point[1];
  });
  return sum / 2;
}

function distanceToSegment(point: Point, from: Point, to: Point): number {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const lengthSquared = dx * dx + dy * dy;
  const along = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((point[0] - from[0]) * dx + (point[1] - from[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (from[0] + along * dx), point[1] - (from[1] + along * dy));
}

/** Douglas–Peucker: the line with every point dropped that lies within the tolerance of what remains. Its ends stay. */
export function simplify(line: readonly Point[], toleranceKm: number): Point[] {
  const keep = new Uint8Array(line.length);
  keep[0] = 1;
  keep[line.length - 1] = 1;
  const spans: [number, number][] = [[0, line.length - 1]];
  for (let span = spans.pop(); span !== undefined; span = spans.pop()) {
    const [from, to] = span;
    const a = line[from];
    const b = line[to];
    if (a === undefined || b === undefined) continue;
    let farthest = -1;
    let reach = toleranceKm;
    for (let index = from + 1; index < to; index++) {
      const point = line[index];
      if (point === undefined) continue;
      const distance = distanceToSegment(point, a, b);
      if (distance > reach) {
        reach = distance;
        farthest = index;
      }
    }
    if (farthest < 0) continue;
    keep[farthest] = 1;
    spans.push([from, farthest], [farthest, to]);
  }
  return line.filter((_, index) => keep[index] === 1);
}

/** The line with points added so that no two neighbours are farther apart than the spacing. */
export function densify(line: readonly Point[], spacingKm: number, closed: boolean): Point[] {
  const out: Point[] = [];
  const count = closed ? line.length : line.length - 1;
  for (let index = 0; index < count; index++) {
    const from = line[index];
    const to = line[(index + 1) % line.length];
    if (from === undefined || to === undefined) continue;
    const steps = Math.max(1, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / spacingKm));
    for (let step = 0; step < steps; step++) out.push([from[0] + ((to[0] - from[0]) * step) / steps, from[1] + ((to[1] - from[1]) * step) / steps]);
  }
  const last = line.at(-1);
  if (!closed && last !== undefined) out.push(last);
  return out;
}

/**
 * Answers whether a point is on land: inside an odd number of rings' edges. Edges are filed by the
 * rows they cross, so a test reads a handful of them and a whole mesh can be asked triangle by triangle.
 */
export class Land {
  readonly #rows = new Map<number, [Point, Point][]>();
  readonly #rowKm: number;

  constructor(rings: readonly (readonly Point[])[], rowKm = 2) {
    this.#rowKm = rowKm;
    for (const ring of rings) {
      ring.forEach((from, index) => {
        const to = ring[(index + 1) % ring.length];
        if (to === undefined || from[1] === to[1]) return;
        const low = Math.floor(Math.min(from[1], to[1]) / rowKm);
        const high = Math.floor(Math.max(from[1], to[1]) / rowKm);
        for (let row = low; row <= high; row++) {
          const edges = this.#rows.get(row);
          if (edges === undefined) this.#rows.set(row, [[from, to]]);
          else edges.push([from, to]);
        }
      });
    }
  }

  has(point: Point): boolean {
    let inside = false;
    for (const [from, to] of this.#rows.get(Math.floor(point[1] / this.#rowKm)) ?? []) {
      if (from[1] > point[1] === to[1] > point[1]) continue;
      if (point[0] < from[0] + ((point[1] - from[1]) / (to[1] - from[1])) * (to[0] - from[0])) inside = !inside;
    }
    return inside;
  }
}

/**
 * Heights between the places they were measured: each asked point takes the mean of its nearest
 * measurements, weighted by inverse squared distance and softened so a measurement is a rise, not a spike.
 */
export class Heights {
  readonly #cells = new Map<string, number[]>();
  readonly #x: number[] = [];
  readonly #y: number[] = [];
  readonly #h: number[] = [];
  readonly #cellKm: number;

  constructor(cellKm = 4) {
    this.#cellKm = cellKm;
  }

  add(point: Point, metres: number): void {
    const index = this.#x.length;
    this.#x.push(point[0]);
    this.#y.push(point[1]);
    this.#h.push(metres);
    const at = `${Math.floor(point[0] / this.#cellKm)},${Math.floor(point[1] / this.#cellKm)}`;
    const cell = this.#cells.get(at);
    if (cell === undefined) this.#cells.set(at, [index]);
    else cell.push(index);
  }

  /** Whether any measurement lies within the reach of a point; the reach must not exceed a cell. */
  near(point: Point, reachKm: number): boolean {
    const column = Math.floor(point[0] / this.#cellKm);
    const row = Math.floor(point[1] / this.#cellKm);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (const index of this.#cells.get(`${column + dx},${row + dy}`) ?? []) {
          if (Math.hypot((this.#x[index] ?? 0) - point[0], (this.#y[index] ?? 0) - point[1]) <= reachKm) return true;
        }
      }
    }
    return false;
  }

  at(point: Point, neighbours = 10, softenKm = 1.2): number {
    const column = Math.floor(point[0] / this.#cellKm);
    const row = Math.floor(point[1] / this.#cellKm);
    const found: [distanceSquared: number, metres: number][] = [];
    // Widen the search ring by ring; one more ring after enough are found, since a nearer one may sit just outside.
    for (let reach = 0, enoughAt = -1; reach < 40 && (enoughAt < 0 || reach <= enoughAt + 1); reach++) {
      for (let dx = -reach; dx <= reach; dx++) {
        for (let dy = -reach; dy <= reach; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== reach) continue;
          for (const index of this.#cells.get(`${column + dx},${row + dy}`) ?? []) {
            const x = this.#x[index] ?? 0;
            const y = this.#y[index] ?? 0;
            found.push([(x - point[0]) ** 2 + (y - point[1]) ** 2, this.#h[index] ?? 0]);
          }
        }
      }
      if (enoughAt < 0 && found.length >= neighbours) enoughAt = reach;
    }
    found.sort((a, b) => a[0] - b[0]);
    let weights = 0;
    let sum = 0;
    for (const [distanceSquared, metres] of found.slice(0, neighbours)) {
      const weight = 1 / (distanceSquared + softenKm * softenKm);
      weights += weight;
      sum += weight * metres;
    }
    return weights === 0 ? 0 : sum / weights;
  }
}
