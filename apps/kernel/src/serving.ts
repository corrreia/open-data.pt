import type { Product as ApiProduct } from "@open-data-pt/api";
import { asObject, asString, isJsonArray, isJsonNumber, isJsonObject, type CanonicalField, type CanonicalSchema, type JsonObject, type JsonValue } from "@open-data-pt/contract";

import type { ChunkObject } from "./chunks";
import type { ProductDetail, ProductView } from "./coordinators";
import { NotFoundError } from "./errors";
import type { Feed } from "./feed-model";
import type { ChangesWindow, ObjectStore, SeriesChangesWindow, SeriesWindow } from "./object-store";
import type { Vocabulary } from "./vocabulary";

/** One equality filter on a string, category or identifier field. */
export interface FieldFilter {
  field: string;
  value: string;
}

/** A longitude/latitude box in degrees. */
export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

/** Row filters a records page or GeoJSON export applies. */
export interface RowFilters {
  where?: FieldFilter[];
  bbox?: BoundingBox;
}

/** What the records endpoint asks a product for. */
export interface RecordQuery {
  limit: number;
  cursor?: string;
  validAt?: string;
  filters?: RowFilters;
}

/** A query the product cannot answer as asked: an unknown field, a bad cursor. */
export class InvalidQueryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidQueryError";
  }
}

/** One page of a product's records, with the cursor for the next one. */
export interface RecordPage {
  data: JsonObject[];
  nextCursor?: string;
}

/** What the changes endpoint asks a product for. */
export interface ChangeQuery {
  knownAt?: string;
  limit: number;
}

/** What the series endpoints ask a product for. */
export interface SeriesQuery {
  seriesKey?: string;
  from?: string;
  to?: string;
  limit: number;
}

/** The product index as the API sees it: the Registry over RPC, which works out what the public may read. */
export interface ProductCatalog {
  listProducts(): Promise<ProductView[]>;
  getProduct(slug: string): Promise<ProductDetail | undefined>;
}

/** A page never reads more than this many chunks, even when a filter rejects most rows. */
const MAX_CHUNKS_PER_PAGE = 8;

/**
 * Public reads. A request looks its product up once, in the Registry, which
 * says whether the public may read it and lists its chunks; the rows, windows
 * and GeoJSON come from R2 objects.
 */
export class Serving {
  constructor(
    private readonly catalog: ProductCatalog,
    private readonly objects: ObjectStore,
  ) {}

  async listProducts() {
    return (await this.catalog.listProducts()).map(publicProduct);
  }

  /** A product with its chunk list; undefined when there is none. */
  async product(slug: string): Promise<ProductDetail | undefined> {
    return this.catalog.getProduct(slug);
  }

  /**
   * One page of records. Filters are applied while reading chunks, and a page
   * still reads at most MAX_CHUNKS_PER_PAGE chunks, so a selective filter can
   * return fewer rows than asked together with a cursor to continue.
   */
  async records(product: ProductDetail, input: RecordQuery): Promise<RecordPage> {
    const matches = rowMatcher(product.schema, input.filters);
    const chunks = product.chunks ?? [];
    const cursor = parseRecordCursor(input.cursor);
    // Only the selected version is served; a cursor into an earlier one would skip or repeat rows.
    if (cursor && cursor.version !== product.version) {
      throw new InvalidQueryError(`cursor belongs to version ${cursor.version}, and the product is now at version ${product.version}; start again without a cursor`);
    }
    const data: JsonObject[] = [];
    let chunk = cursor?.chunk ?? 0;
    let offset = cursor?.offset ?? 0;
    let reads = 0;
    while (chunk < chunks.length && data.length < input.limit && reads < MAX_CHUNKS_PER_PAGE) {
      const rows = await this.chunkRows(chunks[chunk]!.key);
      reads += 1;
      while (offset < rows.length && data.length < input.limit) {
        const { _hash: _h, ...record } = rows[offset]!;
        offset += 1;
        if (input.validAt && !validAt(record, input.validAt)) continue;
        if (matches && !matches(record)) continue;
        data.push(record);
      }
      if (offset >= rows.length) {
        chunk += 1;
        offset = 0;
      }
    }
    const page: RecordPage = { data };
    if (chunk < chunks.length) page.nextCursor = `v${product.version}:${chunk}:${offset}`;
    return page;
  }

  async changes(product: ProductDetail, input: ChangeQuery) {
    if (!product.changesKey) return [];
    const window = await this.objects.read<ChangesWindow>(product.changesKey);
    let changes = window?.changes ?? [];
    const knownAt = input.knownAt;
    if (knownAt) changes = changes.filter((change) => instant(change.observedAt) <= instant(knownAt));
    return changes.slice(0, input.limit);
  }

  async series(product: ProductDetail, input: SeriesQuery) {
    if (!product.seriesKey) return [];
    const window = await this.objects.read<SeriesWindow>(product.seriesKey);
    return filterPoints(window?.points ?? [], input).slice(0, input.limit);
  }

  async seriesChanges(product: ProductDetail, input: SeriesQuery) {
    if (!product.seriesChangesKey) return [];
    const window = await this.objects.read<SeriesChangesWindow>(product.seriesChangesKey);
    return filterPoints(window?.changes ?? [], input).slice(0, input.limit);
  }

  /**
   * Every current record in one response, streamed one chunk at a time like the GeoJSON export, so a
   * reader can hold a whole product without walking a cursor. Filtered, the matching count is only
   * known at the end, so `numberMatched` is left out.
   */
  async allRecords(product: ProductDetail, filters?: RowFilters): Promise<ReadableStream<Uint8Array>> {
    const matches = rowMatcher(product.schema, filters);
    const matched = matches ? "" : `"numberMatched":${servedRows(product)},`;
    return this.streamRows(
      product,
      `{${matched}"data":[`,
      (returned) => `],"numberReturned":${returned}}`,
      (row) => {
        if (matches && !matches(row)) return undefined;
        const { _hash: _h, ...record } = row;
        return JSON.stringify(record);
      },
    );
  }

  /**
   * A product as GeoJSON, streamed one chunk at a time so a large product never
   * sits in memory. A `geometry` field becomes the feature geometry; otherwise
   * a latitude/longitude pair becomes a Point.
   */
  async geoJson(product: ProductDetail, filters?: RowFilters): Promise<ReadableStream<Uint8Array>> {
    const geometryField = product.schema.fields.find((field) => field.type === "geometry")?.name;
    const latitudeField = product.schema.fields.find((field) => field.type === "latitude")?.name;
    const longitudeField = product.schema.fields.find((field) => field.type === "longitude")?.name;
    if (!geometryField && !(latitudeField && longitudeField)) throw new NotFoundError("Product has no geometry or coordinate fields");
    const matches = rowMatcher(product.schema, filters);
    // Filtered, the number of matching features is only known at the end.
    const matched = matches ? "" : `"numberMatched":${servedRows(product)},`;
    const head = `{"type":"FeatureCollection",${matched}"timeStamp":${JSON.stringify(new Date().toISOString())},"features":[`;
    return this.streamRows(
      product,
      head,
      (returned) => `],"numberReturned":${returned}}`,
      (row) => {
        if (matches && !matches(row)) return undefined;
        const feature = toFeature(row, geometryField, latitudeField, longitudeField);
        return feature ? JSON.stringify(feature) : undefined;
      },
    );
  }

  /** One JSON document around a product's rows: the head, then each chunk's serialized rows as it is read, then the tail. */
  private streamRows(product: ProductDetail, head: string, tail: (returned: number) => string, serialize: (row: JsonObject) => string | undefined): ReadableStream<Uint8Array> {
    const chunks = product.chunks ?? [];
    const encoder = new TextEncoder();
    let index = -1;
    let returned = 0;
    return new ReadableStream<Uint8Array>({
      pull: async (controller) => {
        if (index === -1) {
          index = 0;
          controller.enqueue(encoder.encode(head));
          return;
        }
        // A pull that enqueues nothing is not called again, so read on past chunks with no match.
        while (index < chunks.length) {
          const rows = await this.chunkRows(chunks[index]!.key);
          index += 1;
          const parts: string[] = [];
          for (const row of rows) {
            const text = serialize(row);
            if (text !== undefined) parts.push(text);
          }
          if (parts.length === 0) continue;
          controller.enqueue(encoder.encode(`${returned > 0 ? "," : ""}${parts.join(",")}`));
          returned += parts.length;
          return;
        }
        controller.enqueue(encoder.encode(tail(returned)));
        controller.close();
      },
    });
  }

  async dcatCatalog(origin: string, feeds: Feed[], vocabulary: Vocabulary) {
    // DCAT wants a licence as a URI when it has one; a publisher's own terms, or none stated, are named instead.
    const dcatLicence = (key: string) => {
      const licence = vocabulary.licenceRef(key);
      return licence.url ?? licence.name;
    };
    const dcatPublisher = (key: string) => {
      const publisher = vocabulary.publisherRef(key, origin);
      return { "@type": "foaf:Agent", "foaf:name": publisher.name, "foaf:homepage": publisher.url, "foaf:depiction": publisher.logo };
    };
    const products = await this.listProducts();
    return {
      "@context": { dcat: "http://www.w3.org/ns/dcat#", dct: "http://purl.org/dc/terms/", prov: "http://www.w3.org/ns/prov#", foaf: "http://xmlns.com/foaf/0.1/" },
      "@id": `${origin}/api/catalog.dcat.json`,
      "@type": "dcat:Catalog",
      "dct:title": "open-data.pt products",
      "dcat:dataset": products.map((product) => {
        const feed = feeds.find((candidate) => candidate.id === product.feedId);
        const endpoint = product.role === "time-series" ? "series" : "records";
        return {
          "@id": `${origin}/api/products/${encodeURIComponent(product.slug)}`,
          "@type": "dcat:Dataset",
          "dct:title": product.title,
          "dct:description": product.description,
          "dct:modified": product.updatedAt,
          "dct:license": feed ? dcatLicence(feed.licence) : undefined,
          "dct:publisher": feed ? dcatPublisher(feed.publisher) : undefined,
          "dcat:keyword": feed?.topics.length ? [...feed.topics] : undefined,
          "dct:provenance": feed ? `Generated from ${feed.title} through the ${feed.library} library` : undefined,
          "dcat:distribution": [
            { "@type": "dcat:Distribution", "dct:format": "application/json", "dcat:accessURL": `${origin}/api/products/${encodeURIComponent(product.slug)}/${endpoint}` },
          ],
        };
      }),
    };
  }

  private async chunkRows(key: string): Promise<JsonObject[]> {
    const chunk = await this.objects.read<ChunkObject>(key);
    if (!chunk) throw new NotFoundError("A chunk of this product is missing; retry shortly");
    return chunk.rows;
  }
}

/**
 * The rows the record endpoints actually serve: what the chunk list holds. A
 * product's `rowCount` counts the rows of whatever it is made of, and for a
 * time-series product those are points, served by `/series` and never as
 * records, so only the chunks can state a record count without contradicting it.
 */
function servedRows(product: ProductDetail): number {
  return (product.chunks ?? []).reduce((total, chunk) => total + chunk.rows, 0);
}

function parseRecordCursor(cursor: string | undefined): { version: number; chunk: number; offset: number } | undefined {
  if (!cursor) return undefined;
  const match = /^v(\d+):(\d+):(\d+)$/.exec(cursor);
  if (!match) throw new InvalidQueryError("cursor is invalid");
  return { version: Number(match[1]), chunk: Number(match[2]), offset: Number(match[3]) };
}

/** A test one row must pass. */
type RowMatcher = (record: JsonObject) => boolean;

/** Field types an equality filter may compare. */
const FILTERABLE_TYPES = new Set(["string", "category", "identifier"]);

/**
 * The combined test for a product's filters, validated against its schema, or
 * undefined when nothing is filtered. Rows carry each field under its name
 * (or, for some sources, its ID), so both are looked up.
 */
function rowMatcher(schema: CanonicalSchema, filters: RowFilters | undefined): RowMatcher | undefined {
  const tests: RowMatcher[] = [];
  for (const filter of filters?.where ?? []) {
    const field = schema.fields.find((candidate) => candidate.name === filter.field || candidate.id === filter.field);
    if (!field) throw new InvalidQueryError(`where: this product has no field "${filter.field}"`);
    if (!FILTERABLE_TYPES.has(field.type)) {
      throw new InvalidQueryError(`where: "${filter.field}" is a ${field.type} field; only string, category and identifier fields can be filtered`);
    }
    tests.push((record) => {
      const value = fieldValue(record, field);
      return value !== undefined && value !== null && !isJsonObject(value) && !isJsonArray(value) && String(value) === filter.value;
    });
  }
  const box = filters?.bbox;
  if (box) {
    const latitude = schema.fields.find((field) => field.type === "latitude");
    const longitude = schema.fields.find((field) => field.type === "longitude");
    if (!latitude || !longitude) throw new InvalidQueryError("bbox needs a product with latitude and longitude fields");
    tests.push((record) => {
      const y = fieldValue(record, latitude);
      const x = fieldValue(record, longitude);
      return isJsonNumber(x) && isJsonNumber(y) && x >= box.west && x <= box.east && y >= box.south && y <= box.north;
    });
  }
  if (tests.length === 0) return undefined;
  return (record) => tests.every((test) => test(record));
}

function fieldValue(record: JsonObject, field: CanonicalField): JsonValue | undefined {
  return record[field.name] ?? record[field.id];
}

/** A stored or asked-for time as an instant: sources write `…:00Z` and `…:00.000Z` alike, so their text does not sort as time. */
const instant = (time: string) => Date.parse(time);

function validAt(record: JsonObject, at: string): boolean {
  const time = asObject(record._time);
  const validFrom = asString(time?.validFrom);
  const validTo = asString(time?.validTo);
  const moment = instant(at);
  return (validFrom === undefined || instant(validFrom) <= moment) && (validTo === undefined || instant(validTo) >= moment);
}

function toFeature(row: JsonObject, geometryField: string | undefined, latitudeField: string | undefined, longitudeField: string | undefined): JsonObject | undefined {
  const { _hash: _h, ...properties } = row;
  let geometry = geometryField ? asGeometry(row[geometryField]) : undefined;
  if (geometryField) delete properties[geometryField];
  if (!geometry && latitudeField && longitudeField) {
    const latitude = row[latitudeField];
    const longitude = row[longitudeField];
    if (!isJsonNumber(latitude) || !isJsonNumber(longitude)) return undefined;
    geometry = { type: "Point", coordinates: [longitude, latitude] };
    delete properties[latitudeField];
    delete properties[longitudeField];
  }
  if (!geometry) return undefined;
  return { type: "Feature", id: String(row.id), geometry, properties };
}

function filterPoints<T extends { seriesKey: string; eventTime: string }>(points: T[], input: { seriesKey?: string; from?: string; to?: string }): T[] {
  const from = input.from ? instant(input.from) : -Infinity;
  const to = input.to ? instant(input.to) : Infinity;
  return points.filter((point) => {
    if (input.seriesKey && point.seriesKey !== input.seriesKey) return false;
    const at = instant(point.eventTime);
    return at >= from && at <= to;
  });
}

/** GeoJSON geometry types this platform will serve, straight from the source. */
const GEOMETRY_TYPES = new Set(["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"]);

/** A stored geometry value, if it really is one. Anything else is skipped. */
function asGeometry(value: JsonValue | undefined): JsonObject | undefined {
  const candidate = asObject(value);
  const type = asString(candidate?.type);
  if (candidate === undefined || type === undefined || !GEOMETRY_TYPES.has(type)) return undefined;
  const members = type === "GeometryCollection" ? candidate.geometries : candidate.coordinates;
  return isJsonArray(members) ? candidate : undefined;
}

export function publicProduct(entry: ProductView): ApiProduct {
  return {
    id: entry.id,
    slug: entry.slug,
    feedId: entry.feedId,
    title: entry.title,
    description: entry.description,
    role: entry.role,
    schema: entry.schema,
    version: entry.version,
    status: entry.status,
    currentAcquisitionId: entry.currentAcquisitionId,
    watermark: entry.watermark,
    rowCount: entry.rowCount,
    completeness: entry.completeness,
    stale: entry.stale,
    staleAfterSeconds: entry.staleAfterSeconds,
    cadenceSeconds: entry.cadenceSeconds,
    historyMode: entry.historyMode,
    exposeHistory: entry.exposeHistory,
    licence: entry.licence,
    attribution: entry.attribution,
    hasChanges: Boolean(entry.changesKey),
    hasSeries: Boolean(entry.seriesKey),
    updatedAt: entry.updatedAt,
  };
}
