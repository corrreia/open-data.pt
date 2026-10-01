/**
 * Where a point falls in Portugal, for sources that report events anywhere in
 * a wider area (a satellite's whole disk, a lightning network reaching Spain
 * and Morocco) and of which only Portugal's are ours.
 */
export interface PortugalRegion {
  key: "mainland" | "madeira" | "azores";
  name: string;
}

/**
 * Mainland Portugal at 1:110m (Natural Earth, public domain), longitude then
 * latitude. Coarse, about 5 km along the border, which is the grain of the
 * sources it sorts: it keeps Galicia, Castile and Extremadura out.
 */
const MAINLAND_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [-9.03, 41.88],
  [-8.67, 42.13],
  [-8.26, 42.28],
  [-8.01, 41.79],
  [-7.42, 41.79],
  [-7.25, 41.92],
  [-6.67, 41.88],
  [-6.39, 41.38],
  [-6.85, 41.11],
  [-6.86, 40.33],
  [-7.03, 40.18],
  [-7.07, 39.71],
  [-7.5, 39.63],
  [-7.1, 39.03],
  [-7.37, 38.37],
  [-7.03, 38.08],
  [-7.17, 37.8],
  [-7.54, 37.43],
  [-7.45, 37.1],
  [-7.86, 36.84],
  [-8.38, 36.98],
  [-8.9, 36.87],
  [-8.75, 37.65],
  [-8.84, 38.27],
  [-9.29, 38.36],
  [-9.53, 38.74],
  [-9.45, 39.39],
  [-9.05, 39.76],
  [-8.98, 40.16],
  [-8.77, 40.76],
  [-8.79, 41.18],
  [-8.99, 41.54],
];

/** Portugal's three regions, in the order a series lists them. */
export const PORTUGAL_REGIONS: readonly PortugalRegion[] = [
  { key: "mainland", name: "Mainland Portugal" },
  { key: "madeira", name: "Madeira" },
  { key: "azores", name: "Azores" },
];

/**
 * The region a point falls in, or nothing outside Portugal. The island groups
 * sit alone in the ocean, so a box around each holds nothing else.
 */
export function portugalRegion(latitude: number, longitude: number): PortugalRegion | undefined {
  if (insideMainland(longitude, latitude)) return PORTUGAL_REGIONS[0];
  if (longitude >= -17.4 && longitude <= -15.7 && latitude >= 32.3 && latitude <= 33.3) return PORTUGAL_REGIONS[1];
  if (longitude >= -31.5 && longitude <= -24.8 && latitude >= 36.8 && latitude <= 40.1) return PORTUGAL_REGIONS[2];
  return undefined;
}

/** Ray casting: whether a point falls inside the mainland outline. */
function insideMainland(longitude: number, latitude: number): boolean {
  let inside = false;
  for (let index = 0, previous = MAINLAND_OUTLINE.length - 1; index < MAINLAND_OUTLINE.length; previous = index, index += 1) {
    const [x1, y1] = MAINLAND_OUTLINE[index]!;
    const [x2, y2] = MAINLAND_OUTLINE[previous]!;
    if (y1 > latitude !== y2 > latitude && longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}
