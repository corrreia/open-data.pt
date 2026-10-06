import type { Product, ProductExtent, ProductsAtPoint } from "@open-data-pt/api";
import { asObject, parseJson, type JsonObject } from "@open-data-pt/contract";

import { NotFoundError } from "#/api/errors";
import { isLocated, spatialIndexMissing, type ProductIndexEntry } from "#/registry/feed-model";
import type { ProductDetail } from "#/registry/registry";
import { parseChunkRows, type ManifestChunk } from "#/serving/chunks";
import type { ObjectStore } from "#/serving/object-store";
import {
  bboxArray,
  boxOfArray,
  boxesIntersect,
  geometryBox,
  hitTest,
  locatorFor,
  queryBox,
  rowGeometry,
  type Box,
  type Hit,
  type Locator,
  type PointQuery,
} from "#/serving/spatial";

/**
 * What one located product holds at a point: the polygons that contain it
 * and the points and lines within a radius of it, read from only the chunks
 * whose box the point (widened by the radius) falls in.
 *
 * The bounds are per request, and they are what keeps a lookup cheap whatever
 * the product. A chunk is at most 2 Mi characters (CHUNK_LIMITS.maxChars), so
 * reading one costs one R2 read, at most a few MB of memory while it is split
 * into rows and each row parsed in turn, and some 10-20 ms of CPU. Sixteen
 * chunks is then at most 16 R2 reads (the Workers limit is 10,000
 * subrequests), well under the 128 MB isolate, and a few hundred
 * milliseconds of CPU. Measured over every multi-chunk located product in
 * production, a point in place-ordered chunks falls in 1.8 chunks on average
 * and in 8 at most (a municipality's land-use parcels, which are large
 * polygons), so the bound is reached only by a product still in entity order.
 */
export const POINT_LOOKUP = {
  /** Metres around the point within which a point or a line counts. */
  defaultRadius: 25,
  maxRadius: 1000,
  defaultLimit: 10,
  maxLimit: 50,
  maxChunks: 16,
} as const;

/** One point lookup: the point, the radius, how many records to return, and whether to return their geometry. */
export interface PointLookupQuery extends PointQuery {
  limit: number;
  geometry: boolean;
}

/** What a lookup found in one product. */
export interface PointLookup {
  /** The matching records, those that contain the point first and then the nearest, each with `_distance` in metres. */
  data: JsonObject[];
  /** How many records matched in the chunks read; more than `data` holds when `capped`. */
  matched: number;
  capped: boolean;
  /** The product's chunks carry boxes, so only those that can hold the point were read. */
  indexed: boolean;
  /** Every chunk that could hold a match was read. */
  complete: boolean;
}

/**
 * A located product whose chunks have no boxes yet and are too many to read
 * whole within a request: the answer would be a guess, so there is none
 * until its runner has rebuilt them.
 */
export class NotIndexedError extends Error {
  constructor(readonly slug: string) {
    super(`${slug} is not indexed by place yet; its runner is rebuilding it, so retry in a few minutes`);
    this.name = "NotIndexedError";
  }
}

/** How a product is placed, as the API shows it: null for a product with no place, and its box once its chunks carry boxes. */
export function productExtent(entry: Pick<ProductIndexEntry, "kind" | "schema" | "extent">): ProductExtent | null {
  if (!isLocated(entry)) return null;
  return { bbox: entry.extent ? bboxArray(entry.extent) : null, indexed: entry.extent !== undefined };
}

/**
 * Which products reach a point, from their extents alone: no record is read,
 * so this costs what listing the products costs. A located product with no
 * extent yet is named apart, since it may reach the point too.
 */
export function productsAt(products: Product[], query: PointQuery): ProductsAtPoint {
  const area = queryBox(query);
  return {
    point: { lat: query.latitude, lon: query.longitude },
    radius: query.radius,
    data: products.filter((product) => product.extent?.bbox && boxesIntersect(boxOfArray(product.extent.bbox), area)),
    notIndexed: products.filter((product) => product.extent && !product.extent.indexed).map((product) => product.slug),
  };
}

/**
 * The records of one product at a point. A product with neither a geometry
 * nor a latitude/longitude pair has no such view (404, as its GeoJSON). A
 * located product whose chunks have no boxes yet is read whole when that fits
 * the bound, and said to be unindexed; past the bound it is refused rather
 * than answered from part of it.
 */
export async function recordsAt(objects: ObjectStore, product: ProductDetail, query: PointLookupQuery): Promise<PointLookup> {
  const locator = isLocated(product) ? locatorFor(product.schema) : undefined;
  if (!locator) throw new NotFoundError("Product has no geometry or coordinate fields, so nothing in it is at a point");
  const chunks = product.chunks ?? [];
  const area = queryBox(query);
  const indexed = !spatialIndexMissing(product);
  if (!indexed && chunks.length > POINT_LOOKUP.maxChunks) throw new NotIndexedError(product.slug);
  const candidates = indexed ? chunks.filter((chunk) => chunk.box && boxesIntersect(chunk.box, area)) : chunks;
  const read = candidates.slice(0, POINT_LOOKUP.maxChunks);
  const matches: Array<{ record: JsonObject; hit: Hit }> = [];
  for (const chunk of read) matches.push(...(await chunkMatches(objects, chunk, locator, area, query)));
  matches.sort((left, right) => left.hit.distance - right.hit.distance || String(left.record.id).localeCompare(String(right.record.id)));
  const geometryField = locator.geometry;
  const data = matches.slice(0, query.limit).map(({ record, hit }) => {
    const { _hash: _h, ...served } = record;
    if (geometryField && !query.geometry) {
      delete served[geometryField.name];
      delete served[geometryField.id];
    }
    return { ...served, _distance: Math.round(hit.distance * 10) / 10 };
  });
  return { data, matched: matches.length, capped: matches.length > query.limit, indexed, complete: candidates.length <= read.length };
}

/** The rows of one chunk that cover the point: a row whose own box misses the widened point is never measured. */
async function chunkMatches(objects: ObjectStore, chunk: ManifestChunk, locator: Locator, area: Box, query: PointQuery): Promise<Array<{ record: JsonObject; hit: Hit }>> {
  const body = await objects.readText(chunk.key);
  if (body === undefined) throw new NotFoundError("A chunk of this product is missing; retry shortly");
  const matches: Array<{ record: JsonObject; hit: Hit }> = [];
  for (const row of parseChunkRows(body)) {
    const record = asObject(parseJson(row.json));
    const geometry = record ? rowGeometry(locator, record) : undefined;
    const box = geometry ? geometryBox(geometry) : undefined;
    if (!record || !geometry || !box || !boxesIntersect(box, area)) continue;
    const hit = hitTest(geometry, query);
    if (hit) matches.push({ record, hit });
  }
  return matches;
}
