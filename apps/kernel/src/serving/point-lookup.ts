import type { Product, ProductExtent, ProductsAtPoint } from "@open-data-pt/api";
import type { JsonObject } from "@open-data-pt/contract";

import { isLocated, spatialIndexMissing, type ProductIndexEntry } from "#/registry/feed-model";
import type { ProductDetail } from "#/registry/registry";
import type { ManifestChunk } from "#/serving/chunks";
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
 * whose box the point (widened by the radius) falls in. It is a filter on the
 * product's records and GeoJSON (`lat`, `lon`, `radius`), and the scan
 * budget a filtered records page has (RECORD_SCAN_BUDGET) does not apply to
 * it: a point reads these chunks and no others, on every page.
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
  maxChunks: 16,
} as const;

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

/** Where a point filter reads, and how it tests a row. */
export interface PointPlan {
  /** The chunks whose box reaches the point, in chunk order, at most POINT_LOOKUP.maxChunks. */
  chunks: ManifestChunk[];
  /** The product's chunks carry boxes, so only those that can hold the point are read. */
  indexed: boolean;
  /** Every chunk that could hold a match is read. */
  complete: boolean;
  /** How a row stands to the point, or undefined when it does not cover it. */
  hit(record: JsonObject): Hit | undefined;
}

/**
 * The chunks a point filter reads on one product, and the test its rows must
 * pass, or undefined for a product with no place. A located product whose
 * chunks have no boxes yet is read whole when that fits the bound, and said
 * to be unindexed; past the bound it is refused rather than answered from
 * part of it.
 */
export function pointPlan(product: ProductDetail, query: PointQuery): PointPlan | undefined {
  const locator = isLocated(product) ? locatorFor(product.schema) : undefined;
  if (!locator) return undefined;
  const chunks = product.chunks ?? [];
  const area = queryBox(query);
  const indexed = !spatialIndexMissing(product);
  if (!indexed && chunks.length > POINT_LOOKUP.maxChunks) throw new NotIndexedError(product.slug);
  const candidates = indexed ? chunks.filter((chunk) => chunk.box && boxesIntersect(chunk.box, area)) : chunks;
  return {
    chunks: candidates.slice(0, POINT_LOOKUP.maxChunks),
    indexed,
    complete: candidates.length <= POINT_LOOKUP.maxChunks,
    hit: (record) => rowHit(locator, record, area, query),
  };
}

/** A row covers the point when its own box reaches the widened point and its geometry passes the exact test. */
function rowHit(locator: Locator, record: JsonObject, area: Box, query: PointQuery): Hit | undefined {
  const geometry = rowGeometry(locator, record);
  const box = geometry ? geometryBox(geometry) : undefined;
  if (!geometry || !box || !boxesIntersect(box, area)) return undefined;
  return hitTest(geometry, query);
}

/** Metres to the point, to the decimetre, as a row carries it in `_distance`. */
export function servedDistance(hit: Hit): number {
  return Math.round(hit.distance * 10) / 10;
}
