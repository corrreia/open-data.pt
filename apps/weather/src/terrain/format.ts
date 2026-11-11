/**
 * The baked terrain, as the page reads it: `terrain.json` says what `terrain.bin` holds. The binary is
 * unsigned 16-bit triples (x, y, height), first every mesh point and then every border vertex. The
 * first points are the coast and frontier rings, in order, so the page can tell land from sea and
 * build the cliff under the shore.
 */

export interface TerrainSource {
  /** The open-data.pt product the rows were read from. */
  product: string;
  title: string;
  attribution: string;
  licence: string;
  rows: number;
}

export interface TerrainManifest {
  /** When the products were read, ISO 8601. */
  bakedAt: string;
  /** The south-west corner of the quantized square, in kilometres from the projection's origin. */
  west: number;
  south: number;
  /** Kilometres one step of a stored x or y is worth. */
  stepKm: number;
  /** Metres one step of a stored height is worth. */
  stepMetres: number;
  points: number;
  /** How many of the first points make each closed ring of coast and frontier. */
  rings: number[];
  /** How many vertices each district border line has, in the order they follow the points. */
  borders: number[];
  sources: TerrainSource[];
}

export interface Terrain {
  manifest: TerrainManifest;
  /** x, y in kilometres and height in metres, three numbers a point. */
  points: Float32Array;
  borders: Float32Array;
}

export function decodeTerrain(manifest: TerrainManifest, bytes: ArrayBuffer): Terrain {
  const stored = new Uint16Array(bytes);
  const decoded = new Float32Array(stored.length);
  for (let index = 0; index < stored.length; index += 3) {
    decoded[index] = manifest.west + (stored[index] ?? 0) * manifest.stepKm;
    decoded[index + 1] = manifest.south + (stored[index + 1] ?? 0) * manifest.stepKm;
    decoded[index + 2] = (stored[index + 2] ?? 0) * manifest.stepMetres;
  }
  return { manifest, points: decoded.subarray(0, manifest.points * 3), borders: decoded.subarray(manifest.points * 3) };
}
