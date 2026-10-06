import type { Term } from "@open-data-pt/api";
import {
  asObject,
  asString,
  isJsonArray,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  type CanonicalField,
  type CanonicalSchema,
  type JsonObject,
  type JsonValue,
} from "@open-data-pt/contract";
import { ByteWriter, ParquetWriter, geojsonToWkb, type ColumnSource, type KeyValue, type SchemaElement } from "hyparquet-writer";

import { NotFoundError } from "#/api/errors";
import { digest } from "#/hash";
import type { ProductDetail } from "#/registry/registry";
import { parquetKey } from "#/serving/object-store";
import type { ByteRange, FileStore, FileUpload, StoredFile } from "#/serving/ports";

/** The media type registered for Parquet files. */
export const PARQUET_MEDIA_TYPE = "application/vnd.apache.parquet";

/**
 * A row group closes at whichever comes first. Chunks hold at most 2 MiB of
 * JSON each, so eight of them bound what one row group holds in memory while
 * it is encoded, whatever the rows look like.
 */
export const ROW_GROUP_LIMITS = { rows: 65_536, chunks: 8 } as const;

/**
 * The most a product may hold for one request to write its file. Writing reads
 * every chunk once and holds one row group at a time, so memory does not grow
 * with the product; CPU does: CRUS, 234,768 rows in 115 chunks (145 MB of
 * JSON), took 11 s of CPU locally (docs/adr/0018-parquet-downloads.md). These
 * bounds keep a write near half the kernel's 120-second CPU limit even on a
 * slower machine; past them the request is refused with a 413 naming the JSON
 * export, instead of being cut off by the limit. A chunk holds at most 2 MiB.
 */
export const PARQUET_LIMITS = { rows: 1_000_000, chunks: 400 } as const;

/** What one cell of a column may hold before the writer turns it into Parquet's physical type. */
type Cell = JsonValue | Date | Uint8Array;

/** One column of the file: its Parquet schema, where a row holds its value, and how that value is written. */
export interface ParquetColumn {
  name: string;
  element: SchemaElement;
  /** Low-cardinality text is always dictionary-encoded. */
  dictionary: boolean;
  /** GeoJSON written as WKB, described by the file's GeoParquet metadata. */
  geometry: boolean;
  read(row: JsonObject): JsonValue | undefined;
  /** The value to write, or undefined when it cannot be written as this column's type and is left null. */
  convert(value: JsonValue): Cell | undefined;
}

/** Where the data in a file comes from and under what terms it may be used. */
export interface ParquetSource {
  /** The product on open-data.pt's API. */
  apiUrl: string;
  publisher?: Term;
  /** Where the latest collection read the data: a page a person can open. */
  sourceUrl?: string;
}

/** What writing one file did. */
export interface ParquetWriteResult {
  rows: number;
  rowGroups: number;
  bytes: number;
  /** Values that could not be written as their column's type, by column; they are null in the file. */
  dropped: Record<string, number>;
}

/** A product's Parquet file, ready to send, and whether this request had to write it. */
export interface ParquetDownload {
  file: StoredFile;
  etag: string;
  /** Present when this request encoded the file; a later request finds it in R2. */
  written?: ParquetWriteResult;
}

/** The product cannot be written as one file within a request's CPU budget. */
export class ParquetTooLargeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParquetTooLargeError";
  }
}

const STRING: SchemaElement = { name: "", type: "BYTE_ARRAY", converted_type: "UTF8", logical_type: { type: "STRING" } };
const DOUBLE: SchemaElement = { name: "", type: "DOUBLE" };
const BOOLEAN: SchemaElement = { name: "", type: "BOOLEAN" };
const DATE: SchemaElement = { name: "", type: "INT32", converted_type: "DATE", logical_type: { type: "DATE" } };
const TIMESTAMP: SchemaElement = {
  name: "",
  type: "INT64",
  converted_type: "TIMESTAMP_MILLIS",
  logical_type: { type: "TIMESTAMP", isAdjustedToUTC: true, unit: "MILLIS" },
};
const JSON_TEXT: SchemaElement = { name: "", type: "BYTE_ARRAY", converted_type: "JSON", logical_type: { type: "JSON" } };
/** Plain bytes: GeoParquet's WKB column, which every GeoParquet reader opens. */
const WKB: SchemaElement = { name: "", type: "BYTE_ARRAY" };

/** The clocks each served row carries in `_time`, as their own columns after the product's fields. */
const TIME_COLUMNS: ReadonlyArray<{ name: string; member: string; timestamp: boolean }> = [
  { name: "_event_time", member: "event", timestamp: true },
  { name: "_valid_from", member: "validFrom", timestamp: true },
  { name: "_valid_to", member: "validTo", timestamp: true },
  { name: "_source_published_at", member: "sourcePublished", timestamp: true },
  { name: "_source_sequence", member: "sequence", timestamp: false },
  { name: "_observed_at", member: "observed", timestamp: true },
];

/**
 * The file's columns: the entity key as `id`, then every field of the
 * product's canonical schema in order, then the row's clocks. A name already
 * taken keeps its first column.
 */
export function parquetColumns(schema: CanonicalSchema): ParquetColumn[] {
  const columns: ParquetColumn[] = [
    { name: "id", element: { ...STRING, name: "id", repetition_type: "REQUIRED" }, dictionary: false, geometry: false, read: (row) => row.id, convert: textCell },
  ];
  const taken = new Set(["id"]);
  for (const field of schema.fields) {
    if (taken.has(field.name)) continue;
    taken.add(field.name);
    columns.push(fieldColumn(field));
  }
  for (const clock of TIME_COLUMNS) {
    if (taken.has(clock.name)) continue;
    taken.add(clock.name);
    columns.push({
      name: clock.name,
      element: { ...(clock.timestamp ? TIMESTAMP : STRING), name: clock.name, repetition_type: "OPTIONAL" },
      dictionary: false,
      geometry: false,
      read: (row) => asObject(row._time)?.[clock.member],
      convert: clock.timestamp ? timestampCell : textCell,
    });
  }
  return columns;
}

function fieldColumn(field: CanonicalField): ParquetColumn {
  const read = (row: JsonObject) => row[field.name] ?? row[field.id];
  const column = (element: SchemaElement, convert: ParquetColumn["convert"], dictionary = false, geometry = false): ParquetColumn => ({
    name: field.name,
    element: { ...element, name: field.name, repetition_type: "OPTIONAL" },
    dictionary,
    geometry,
    read,
    convert,
  });
  switch (field.type) {
    case "number":
    case "latitude":
    case "longitude":
      return column(DOUBLE, numberCell);
    case "boolean":
      return column(BOOLEAN, booleanCell);
    case "date":
      return column(DATE, dateCell);
    case "datetime":
      return column(TIMESTAMP, timestampCell);
    case "json":
      return column(JSON_TEXT, (value) => value);
    case "geometry":
      return column(WKB, wkbCell, false, true);
    case "category":
      return column(STRING, textCell, true);
    case "string":
    case "identifier":
    case "url":
    case "color":
      return column(STRING, textCell);
  }
}

/* ---------- Cells ---------- */

/** Text is always writable: a number or a flag as written, anything else as its JSON. */
function textCell(value: JsonValue): Cell {
  if (isJsonString(value)) return value;
  if (isJsonNumber(value) || isJsonBoolean(value)) return String(value);
  return JSON.stringify(value);
}

function numberCell(value: JsonValue): Cell | undefined {
  if (isJsonNumber(value)) return value;
  if (isJsonString(value) && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function booleanCell(value: JsonValue): Cell | undefined {
  if (isJsonBoolean(value)) return value;
  if (value === "true") return true;
  if (value === "false") return false;
  return undefined;
}

/** A calendar date as its source wrote it: the date part of the text, never shifted by a time zone. */
function dateCell(value: JsonValue): Cell | undefined {
  if (!isJsonString(value)) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return undefined;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.getUTCDate() === Number(match[3]) ? date : undefined;
}

/** An instant from ISO 8601 text. Numbers are left out: seconds and milliseconds cannot be told apart. */
function timestampCell(value: JsonValue): Cell | undefined {
  if (!isJsonString(value)) return undefined;
  const time = Date.parse(value);
  return Number.isNaN(time) ? undefined : new Date(time);
}

const GEOMETRY_TYPES = new Set(["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon", "GeometryCollection"]);

/** A GeoJSON geometry as the WKB writer takes it. */
type WkbGeometry = Parameters<typeof geojsonToWkb>[0];

/** A geometry the WKB writer can read: a known type name over an array of coordinates or members. */
function isWkbGeometry(value: JsonValue): value is JsonValue & WkbGeometry {
  return asGeometry(value) !== undefined;
}

/** A GeoJSON geometry as ISO WKB, or undefined for anything that is not one. */
function wkbCell(value: JsonValue): Cell | undefined {
  if (!isWkbGeometry(value)) return undefined;
  try {
    return geojsonToWkb(value);
  } catch {
    // Coordinates the writer cannot read, such as positions of five numbers.
    return undefined;
  }
}

function asGeometry(value: JsonValue | undefined): JsonObject | undefined {
  const candidate = asObject(value);
  const type = asString(candidate?.type);
  if (candidate === undefined || type === undefined || !GEOMETRY_TYPES.has(type)) return undefined;
  const members = type === "GeometryCollection" ? candidate.geometries : candidate.coordinates;
  return isJsonArray(members) ? candidate : undefined;
}

/* ---------- GeoParquet ---------- */

/** What GeoParquet's `geo` metadata says about one geometry column: its types and its bounding box. */
class GeometryExtent {
  readonly types = new Set<string>();
  west = Infinity;
  south = Infinity;
  east = -Infinity;
  north = -Infinity;

  add(geometry: JsonObject): void {
    const type = asString(geometry.type) ?? "";
    if (type === "GeometryCollection") {
      this.types.add(type);
      for (const member of isJsonArray(geometry.geometries) ? geometry.geometries : []) if (isJsonObject(member)) this.walk(member);
      return;
    }
    const dimensions = this.positions(geometry.coordinates);
    this.types.add(dimensions >= 3 ? `${type} Z` : type);
  }

  private walk(geometry: JsonObject): void {
    if (asString(geometry.type) === "GeometryCollection") {
      for (const member of isJsonArray(geometry.geometries) ? geometry.geometries : []) if (isJsonObject(member)) this.walk(member);
      return;
    }
    this.positions(geometry.coordinates);
  }

  /** Widens the box by every position under `coordinates`; returns the most dimensions one had. */
  private positions(coordinates: JsonValue | undefined): number {
    if (!isJsonArray(coordinates)) return 0;
    const [x, y] = coordinates;
    if (isJsonNumber(x) && isJsonNumber(y)) {
      this.west = Math.min(this.west, x);
      this.east = Math.max(this.east, x);
      this.south = Math.min(this.south, y);
      this.north = Math.max(this.north, y);
      return coordinates.length;
    }
    let most = 0;
    for (const member of coordinates) most = Math.max(most, this.positions(member));
    return most;
  }

  metadata(): JsonObject {
    // Lon/lat in WGS 84 (GeoJSON's own), which is GeoParquet's default CRS, so `crs` is left out.
    const column: JsonObject = { encoding: "WKB", geometry_types: [...this.types].sort() };
    if (Number.isFinite(this.west)) column.bbox = [this.west, this.south, this.east, this.north];
    return column;
  }
}

/* ---------- Writing ---------- */

/** The writer's buffer, handed to the upload after every row group, so a file never sits whole in memory. */
class FlushingWriter extends ByteWriter {
  constructor(private readonly upload: FileUpload) {
    super(1 << 20);
  }

  flush(): Promise<void> {
    const bytes = this.getBytes().slice();
    this.index = 0;
    return this.upload.write(bytes);
  }

  override finish(): Promise<void> {
    return this.flush();
  }
}

/**
 * Write rows as one Parquet file, a row group at a time: `batches` yields the
 * rows of one chunk at a time, and a row group closes after
 * ROW_GROUP_LIMITS.rows rows or ROW_GROUP_LIMITS.chunks chunks. Metadata that
 * is only known at the end — values dropped, the geometry extent — goes in the
 * footer with `metadata`.
 */
export async function writeParquet(columns: ParquetColumn[], batches: AsyncIterable<JsonObject[]>, metadata: KeyValue[], upload: FileUpload): Promise<ParquetWriteResult> {
  const writer = new FlushingWriter(upload);
  const schema: SchemaElement[] = [{ name: "schema", num_children: columns.length }, ...columns.map((column) => column.element)];
  const parquet = new ParquetWriter({ writer, schema, kvMetadata: metadata });
  const extents = new Map(columns.filter((column) => column.geometry).map((column) => [column.name, new GeometryExtent()]));
  const dropped: Record<string, number> = {};
  let buffers: Cell[][] = columns.map(() => []);
  let buffered = 0;
  let chunks = 0;
  let rows = 0;
  let rowGroups = 0;

  const flushGroup = async () => {
    if (buffered === 0) return;
    const columnData: ColumnSource[] = columns.map((column, index) => {
      const source: ColumnSource = { name: column.name, data: buffers[index]!, nullable: column.element.repetition_type !== "REQUIRED" };
      if (column.dictionary) source.encoding = "RLE_DICTIONARY";
      return source;
    });
    await parquet.write({ columnData, rowGroupSize: buffered });
    rows += buffered;
    rowGroups += 1;
    buffers = columns.map(() => []);
    buffered = 0;
    chunks = 0;
  };

  for await (const batch of batches) {
    for (const row of batch) {
      for (let index = 0; index < columns.length; index += 1) {
        const column = columns[index]!;
        const value = column.read(row);
        let cell: Cell | null = null;
        if (value !== undefined && value !== null) {
          const converted = column.convert(value);
          if (converted === undefined) dropped[column.name] = (dropped[column.name] ?? 0) + 1;
          else {
            cell = converted;
            const geometry = column.geometry ? asGeometry(value) : undefined;
            if (geometry) extents.get(column.name)?.add(geometry);
          }
        }
        buffers[index]!.push(cell);
      }
      buffered += 1;
    }
    chunks += 1;
    if (buffered >= ROW_GROUP_LIMITS.rows || chunks >= ROW_GROUP_LIMITS.chunks) await flushGroup();
  }
  await flushGroup();

  const footer = [...metadata];
  if (Object.keys(dropped).length > 0) footer.push({ key: "dropped_values", value: JSON.stringify(dropped) });
  if (extents.size > 0) {
    const geo: JsonObject = {
      version: "1.1.0",
      primary_column: [...extents.keys()][0]!,
      columns: Object.fromEntries([...extents].map(([name, extent]) => [name, extent.metadata()])),
    };
    footer.push({ key: "geo", value: JSON.stringify(geo) });
  }
  parquet.kvMetadata = footer;
  await parquet.finish();
  return { rows, rowGroups, bytes: writer.offset, dropped };
}

/** The key-value metadata every file carries: what it is, which version, under what terms, and from where. */
export function parquetMetadata(product: ProductDetail, source: ParquetSource): KeyValue[] {
  const entries: Array<[string, string | undefined]> = [
    ["product", product.slug],
    ["title", product.title],
    ["description", product.description],
    ["version", String(product.version)],
    ["updated_at", product.updatedAt],
    ["licence", product.licence?.name],
    ["licence_id", product.licence?.id],
    ["licence_url", product.licence?.url],
    ["attribution", product.attribution ?? undefined],
    ["publisher", source.publisher?.name],
    ["publisher_url", source.publisher?.url],
    ["source", source.sourceUrl],
    ["api", source.apiUrl],
  ];
  return entries.flatMap(([key, value]) => (value === undefined ? [] : [{ key, value }]));
}

/**
 * The digest of the terms a file states. Its key follows the data alone, so
 * a file written before a licence or attribution changed is found by its
 * metadata, and written again.
 */
export function termsDigest(product: ProductDetail): string {
  return digest(JSON.stringify([product.licence?.id ?? null, product.licence?.url ?? null, product.attribution]));
}

/** The rows of one chunk, by its key. */
export type ChunkReader = (key: string) => Promise<JsonObject[]>;

/**
 * Parquet downloads of record products. A file is written on the first
 * request for a product version, kept in R2 under a key derived from that
 * version's chunks, and read back from there by every later request; it is
 * deleted with the version's chunks once a newer version replaces it.
 */
export class ParquetExports {
  constructor(
    private readonly files: FileStore,
    private readonly readChunk: ChunkReader,
  ) {}

  async download(product: ProductDetail, describe: () => Promise<ParquetSource>, range?: (size: number) => ByteRange | undefined): Promise<ParquetDownload> {
    const key = parquetKey(product);
    if (key === undefined || product.status !== "current") {
      throw new NotFoundError(
        product.kind === "series"
          ? "A time series has no Parquet download; read it with /series, /series/summary or /series/range"
          : "This product has no current version to download",
      );
    }
    const terms = termsDigest(product);
    let info = await this.files.headFile(key);
    let written: ParquetWriteResult | undefined;
    if (!info || info.metadata.terms !== terms) {
      assertExportable(product);
      written = await this.write(product, key, terms, await describe());
      info = { size: written.bytes, metadata: { terms } };
    }
    const file = await this.files.getFile(key, range?.(info.size));
    if (!file) throw new NotFoundError("The Parquet file of this product is being replaced; retry shortly");
    const download: ParquetDownload = { file, etag: `"${key.slice(key.lastIndexOf("/") + 1, -".parquet".length)}-${terms}"` };
    if (written) download.written = written;
    return download;
  }

  private async write(product: ProductDetail, key: string, terms: string, source: ParquetSource): Promise<ParquetWriteResult> {
    const started = Date.now();
    const upload = this.files.uploadFile(key, PARQUET_MEDIA_TYPE, { terms });
    const readChunk = this.readChunk;
    const chunks = product.chunks ?? [];
    async function* batches(): AsyncGenerator<JsonObject[]> {
      for (const chunk of chunks) yield await readChunk(chunk.key);
    }
    try {
      const result = await writeParquet(parquetColumns(product.schema), batches(), parquetMetadata(product, source), upload);
      await upload.close();
      console.log(JSON.stringify({ event: "parquet_written", slug: product.slug, version: product.version, ...result, ms: Date.now() - started }));
      return result;
    } catch (error) {
      await upload.abort();
      throw error;
    }
  }
}

/** Refuse, before any work, a product whose file one request could not write. */
function assertExportable(product: ProductDetail): void {
  const chunks = product.chunks ?? [];
  const rows = chunks.reduce((total, chunk) => total + chunk.rows, 0);
  if (rows > PARQUET_LIMITS.rows || chunks.length > PARQUET_LIMITS.chunks) {
    throw new ParquetTooLargeError(
      `${product.slug} has ${rows} rows in ${chunks.length} chunks, more than one request can write as Parquet (at most ${PARQUET_LIMITS.rows} rows in ${PARQUET_LIMITS.chunks} chunks). Read it whole as JSON from /api/products/${product.slug}/records/all instead.`,
    );
  }
}
