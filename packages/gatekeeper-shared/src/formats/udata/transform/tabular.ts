import {
  BUFFERED_SOURCE_MAX_BYTES,
  asArray,
  asArrayOrEmpty,
  asBoolean,
  asNumber,
  asObject,
  asString,
  hashString,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  parseJson,
  readBoundedBytes,
  streamCsvRows,
  streamJsonArray,
} from "../../../index";
import type {
  CanonicalField,
  CanonicalRecord,
  CanonicalSchema,
  JsonObject,
  JsonValue,
  NormalizedRow,
  ProductDeclaration,
  ProductFinalization,
  StreamingSummary,
  StreamingTransform,
  TransformContext,
} from "../../../index";
import { isUtf8, peekBody, sniffJson, sniffText, type JsonSniff } from "./body";
import type { Transformer } from "./transformer";

/**
 * Rows profiled before the first one is published. Column types and the key
 * field are decided from them; every later row is read with those decisions
 * while bounded counters keep checking them. A distribution is published once,
 * as its table: numeric columns are never guessed into time series.
 */
const SAMPLE_ROWS = 5_000;
/** The sample also stops at this much row JSON, so wide rows cannot make it large. */
const SAMPLE_BYTES = 4 * 1024 * 1024;
/** Bytes read up front to choose the text encoding, the delimiter and the JSON layout. */
const PREFIX_BYTES = 64 * 1024;
const MAX_JSON_ROW_BYTES = 8 * 1024 * 1024;
const MAX_JSON_ENVELOPE_BYTES = 1024 * 1024;
const MAX_DISTINCT = 20;
const PORTUGAL = { minLatitude: 32, maxLatitude: 43, minLongitude: -32, maxLongitude: -6 };
const CATEGORY_NAME = /^(tipo|type|categoria|category|estado|status|sexo|genero)$/;
const URL_NAME = /(^| )(url|website|link|pagina web)( |$)/;

type InferredType = CanonicalField["type"];

/** Rows in source order, and what reading them taught about the source. */
interface TableStream {
  /** Header names; empty when the columns are the rows' own keys (JSON). */
  columns: string[];
  source: JsonObject;
  rows: AsyncGenerator<JsonObject>;
}

interface ProfiledColumn {
  name: string;
  type: InferredType;
  nullable: boolean;
  unit?: string;
  display?: CanonicalField["display"];
}

/** What every row said about one column, in bounded counters. */
interface ColumnCounter {
  present: number;
  nullable: boolean;
  urls: number;
  colors: number;
  /** Distinct readings, kept only up to one past the category limit. */
  distinct: Set<string>;
  /** Values after the sample that did not read as the column's type. */
  unreadable: number;
}

/** Where the rows of a JSON document are. */
interface JsonRows {
  path: string[];
  layout: "array" | "feature-collection" | "object";
}

export class TabularTransformer implements Transformer {
  readonly id = "tabular-v2";
  readonly version = "4";

  async transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
    const format = context.feed.config.format?.toLowerCase();
    const productSlug = context.feed.config.productSlug;
    if (!productSlug) throw new Error("Tabular feeds require productSlug");
    if (format !== "csv" && format !== "json" && format !== "geojson") {
      throw new Error(`Unsupported tabular format: ${format}`);
    }
    const table = format === "csv"
      ? await readCsvTable(body, context.feed.config.headerRow)
      : await readJsonTable(body);

    const sample: JsonObject[] = [];
    let sampleBytes = 0;
    let exhausted = false;
    let names: string[];
    let columns: ProfiledColumn[];
    let keyField: string | undefined;
    let eventTimeColumn: string | undefined;
    try {
      while (sample.length < SAMPLE_ROWS && sampleBytes < SAMPLE_BYTES) {
        const next = await table.rows.next();
        if (next.done) {
          exhausted = true;
          break;
        }
        sample.push(next.value);
        sampleBytes += JSON.stringify(next.value).length;
      }
      names = uniqueInOrder([...table.columns, ...sample.flatMap((row) => Object.keys(row))]);
      columns = profileColumns(names, sample);
      applyColorBadge(columns);
      keyField = chooseKeyField(context.feed.config.keyField, columns, sample);
      eventTimeColumn = chooseEventTimeColumn(context.feed.config.eventTimeField, columns);
    } catch (error) {
      await table.rows.return(undefined);
      throw error;
    }

    const title = context.feed.config.productTitle ?? context.feed.title;
    const description = context.feed.config.productDescription ?? context.feed.description;
    // One distribution file is read whole, so this product is the source's whole scope;
    // a body the collector already knew to be partial weakens it again in the kernel.
    const products: ProductDeclaration[] = [
      {
        productKey: "records",
        slug: productSlug,
        title,
        description,
        role: context.feed.semantics.defaultProductRole,
        kind: "record",
        schema: schemaOf(columns),
        updateMode: "authoritative-snapshot",
        completeness: "complete",
      },
    ];

    const publisher = new RowPublisher(columns, keyField, eventTimeColumn, sample);

    return {
      products,
      rows: publishRows(table, sample, exhausted, publisher),
      finish: () => publisher.finish(),
    };
  }
}

/** The sample first, then every remaining row, each published under the sample's decisions. */
async function* publishRows(
  table: TableStream,
  sample: JsonObject[],
  exhausted: boolean,
  publisher: RowPublisher,
): AsyncGenerator<NormalizedRow> {
  try {
    for (const row of sample) yield* publisher.publish(row);
    sample.length = 0;
    publisher.endSample();
    if (exhausted) return;
    while (true) {
      const next = await table.rows.next();
      if (next.done) return;
      yield* publisher.publish(next.value);
    }
  } finally {
    await table.rows.return(undefined);
  }
}

/**
 * Publishes one row at a time under the decisions the sample made, and keeps
 * bounded counters over every row so `finish` can report the final schema.
 */
class RowPublisher {
  private readonly counters = new Map<string, ColumnCounter>();
  private readonly lateColumns: ProfiledColumn[] = [];
  private readonly sampleKeys: Map<string, number>;
  /** Keys already published after the sample; a repeat gets a row-hash identity instead. */
  private readonly seenKeys = new Set<string>();
  private inSample = true;
  private accepted = 0;

  constructor(
    private readonly columns: ProfiledColumn[],
    private readonly keyField: string | undefined,
    private readonly eventTimeColumn: string | undefined,
    sample: JsonObject[],
  ) {
    this.sampleKeys = countKeys(keyField, sample);
    for (const column of columns) this.counters.set(column.name, emptyCounter());
  }

  endSample(): void {
    for (const key of this.sampleKeys.keys()) this.seenKeys.add(key);
    this.sampleKeys.clear();
    this.inSample = false;
  }

  *publish(row: JsonObject): Generator<NormalizedRow> {
    for (const name of Object.keys(row)) {
      if (!this.counters.has(name)) this.addLateColumn(name, row[name] ?? null);
    }
    const payload: JsonObject = {};
    for (const column of this.columns) this.read(column, row, payload);
    for (const column of this.lateColumns) this.read(column, row, payload);

    const rawKey = this.keyField === undefined ? undefined : cellText(row[this.keyField]);
    const unique = rawKey !== undefined && (this.inSample ? this.sampleKeys.get(rawKey) === 1 : !this.seenKeys.has(rawKey));
    if (rawKey !== undefined && !this.inSample) this.seenKeys.add(rawKey);
    const record: CanonicalRecord = {
      entityKey: unique && rawKey !== undefined ? rawKey : `row-${stableRowHash(row)}`,
      payload,
    };
    const eventTime = this.eventTimeColumn === undefined
      ? undefined
      : parseEventTime(row[this.eventTimeColumn], this.eventTimeColumn);
    if (eventTime !== undefined) record.eventTime = eventTime;
    this.accepted += 1;
    yield { productKey: "records", record };
  }

  finish(): StreamingSummary {
    const final = [...this.columns, ...this.lateColumns].map((column) => this.finalColumn(column, this.counters.get(column.name)));
    applyColorBadge(final);
    const products: ProductFinalization[] = [{ productKey: "records", schema: schemaOf(final) }];
    return { quality: { acceptedRecords: this.accepted, rejectedRecords: 0 }, products };
  }

  private read(column: ProfiledColumn, row: JsonObject, payload: JsonObject): void {
    const raw = row[column.name] ?? null;
    const value = parseValue(raw, column.type);
    payload[column.name] = value;
    const counter = this.counters.get(column.name);
    if (!counter) return;
    if (isEmpty(raw)) {
      counter.nullable = true;
      return;
    }
    counter.present += 1;
    if (value === null) {
      counter.nullable = true;
      if (!this.inSample) counter.unreadable += 1;
    }
    if (column.type === "url" && isUrl(raw)) counter.urls += 1;
    else if (column.type === "color" && isColor(raw)) counter.colors += 1;
    else if (column.type === "category" && counter.distinct.size <= MAX_DISTINCT) counter.distinct.add(cellText(raw) ?? "");
  }

  private addLateColumn(name: string, value: JsonValue): void {
    const column: ProfiledColumn = { name, type: isJsonObject(value) || isJsonArray(value) ? "json" : "string", nullable: true };
    const label = displayLabel(name);
    if (label !== name) column.display = { label };
    this.lateColumns.push(column);
    this.counters.set(name, emptyCounter());
  }

  /** Types whose payload is the source text may still narrow to `string`; others were fixed by the sample. */
  private finalColumn(column: ProfiledColumn, counter: ColumnCounter | undefined): ProfiledColumn {
    const final: ProfiledColumn = { name: column.name, type: column.type, nullable: column.nullable || (counter?.nullable ?? false) };
    if (column.unit !== undefined) final.unit = column.unit;
    if (column.display?.label !== undefined) final.display = { label: column.display.label };
    if (!counter || counter.present === 0) return final;
    const name = normalizeName(column.name);
    if (column.type === "category" && !CATEGORY_NAME.test(name) && counter.distinct.size > MAX_DISTINCT) final.type = "string";
    if (column.type === "url" && counter.urls < counter.present && !(URL_NAME.test(name) && counter.urls / counter.present >= 0.9)) final.type = "string";
    if (column.type === "color" && counter.colors < counter.present) final.type = "string";
    return final;
  }
}

function emptyCounter(): ColumnCounter {
  return { present: 0, nullable: false, urls: 0, colors: 0, distinct: new Set(), unreadable: 0 };
}

/* ---------- Reading the source ---------- */

async function readCsvTable(body: ReadableStream<Uint8Array>, configuredHeaderRow?: string): Promise<TableStream> {
  const peeked = await peekBody(body, PREFIX_BYTES);
  const utf8 = isUtf8(peeked.prefix, peeked.complete);
  const encoding = utf8 ? "utf-8" : "windows-1252";
  const delimiter = detectDelimiter(sniffText(peeked.prefix, utf8));
  const raw = streamCsvRows(peeked.body, { delimiter, encoding: utf8 ? "utf-8" : "latin1" })[Symbol.asyncIterator]();
  const nextRow = async (): Promise<string[] | undefined> => {
    while (true) {
      const next = await raw.next();
      if (next.done) return undefined;
      const row = next.value.map((value) => value.trim());
      if (row.some((value) => value !== "")) return row;
    }
  };

  const wanted = configuredHeaderRow ? Number.parseInt(configuredHeaderRow, 10) : 13;
  const head: string[][] = [];
  while (head.length < wanted) {
    const row = await nextRow();
    if (!row) break;
    head.push(row);
  }
  if (head.length === 0) {
    return { columns: [], source: { encoding, delimiter, headerRow: 1 }, rows: listRows([]) };
  }
  let headerIndex: number;
  try {
    headerIndex = configuredHeaderRow ? parseHeaderRow(configuredHeaderRow, head.length) : detectHeaderRow(head);
  } catch (error) {
    await raw.return?.();
    throw error;
  }
  const columns = uniqueHeaders(head[headerIndex] ?? []);
  const pending = head.slice(headerIndex + 1);
  async function* rows(): AsyncGenerator<JsonObject> {
    try {
      for (const row of pending) yield rowToObject(columns, row);
      pending.length = 0;
      while (true) {
        const row = await nextRow();
        if (!row) return;
        yield rowToObject(columns, row);
      }
    } finally {
      await raw.return?.();
    }
  }
  return { columns, source: { encoding, delimiter, headerRow: headerIndex + 1 }, rows: rows() };
}

/**
 * JSON rows stream element by element from a top-level array or from the
 * `features`/`data`/`results`/`items` array a bounded prefix points at. A
 * document with no such array (one object), or one that is not UTF-8, is
 * buffered under the shared 16 MiB cap instead.
 */
async function readJsonTable(body: ReadableStream<Uint8Array>): Promise<TableStream> {
  const peeked = await peekBody(body, PREFIX_BYTES);
  const layout = isUtf8(peeked.prefix, peeked.complete) ? jsonRowsAt(sniffJson(sniffText(peeked.prefix, true))) : undefined;
  if (!layout) return readBufferedJsonTable(peeked.body);
  const stream = streamJsonArray(peeked.body, layout.path, {
    maxElementBytes: MAX_JSON_ROW_BYTES,
    maxEnvelopeBytes: MAX_JSON_ENVELOPE_BYTES,
  });
  const features = layout.layout === "feature-collection";
  async function* rows(): AsyncGenerator<JsonObject> {
    for await (const element of stream.elements) {
      if (!isJsonObject(element)) continue;
      yield features ? featureRecord(element) : flattenJsonRecord(element);
    }
  }
  return { columns: [], source: { encoding: "utf-8", layout: layout.layout }, rows: rows() };
}

async function readBufferedJsonTable(body: ReadableStream<Uint8Array>): Promise<TableStream> {
  const decoded = decodeText(await readBoundedBytes(body, BUFFERED_SOURCE_MAX_BYTES));
  const value = parseJson(decoded.text);
  const objects = extractJsonRecords(value);
  return {
    columns: uniqueInOrder(objects.flatMap((row) => Object.keys(row))),
    source: { encoding: decoded.encoding, layout: jsonLayout(value) },
    rows: listRows(objects),
  };
}

async function* listRows(rows: JsonObject[]): AsyncGenerator<JsonObject> {
  yield* rows;
}

function jsonRowsAt(sniff: JsonSniff): JsonRows | undefined {
  if (sniff.root === "array") return { path: [], layout: "array" };
  if (sniff.root !== "object") return undefined;
  if (sniff.arrays.includes("features") && (sniff.type === undefined || sniff.type === "FeatureCollection")) {
    return { path: ["features"], layout: "feature-collection" };
  }
  const key = ["data", "results", "items"].find((candidate) => sniff.arrays.includes(candidate));
  return key === undefined ? undefined : { path: [key], layout: "object" };
}

/** Source text with the encoding it had to be read in to come out valid. */
interface DecodedText {
  text: string;
  encoding: "utf-8" | "windows-1252";
}

function decodeText(bytes: Uint8Array): DecodedText {
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes).replace(/^\uFEFF/, ""),
      encoding: "utf-8",
    };
  } catch {
    return {
      text: new TextDecoder("windows-1252").decode(bytes).replace(/^\uFEFF/, ""),
      encoding: "windows-1252",
    };
  }
}

function detectDelimiter(text: string): "," | ";" {
  const records = firstLogicalRecords(text, 8);
  const comma = records.reduce((sum, row) => sum + countDelimiter(row, ","), 0);
  const semicolon = records.reduce((sum, row) => sum + countDelimiter(row, ";"), 0);
  return semicolon > comma ? ";" : ",";
}

function firstLogicalRecords(text: string, maximum: number): string[] {
  const records: string[] = [];
  let record = "";
  let quoted = false;
  for (let index = 0; index < text.length && records.length < maximum; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        record += '""';
        index += 1;
        continue;
      }
      quoted = !quoted;
    }
    if (!quoted && (character === "\n" || character === "\r")) {
      if (record.trim() !== "") records.push(record);
      record = "";
      if (character === "\r" && text[index + 1] === "\n") index += 1;
    } else {
      record += character;
    }
  }
  if (record.trim() !== "" && records.length < maximum) records.push(record);
  return records;
}

function countDelimiter(record: string, delimiter: string): number {
  let count = 0;
  let quoted = false;
  for (let index = 0; index < record.length; index += 1) {
    const character = record[index];
    if (character === '"') {
      if (quoted && record[index + 1] === '"') index += 1;
      else quoted = !quoted;
    } else if (!quoted && character === delimiter) {
      count += 1;
    }
  }
  return count;
}

function parseHeaderRow(value: string, rowCount: number): number {
  const row = Number.parseInt(value, 10);
  if (!Number.isInteger(row) || row < 1 || row > rowCount) {
    throw new Error(`headerRow must be between 1 and ${rowCount}`);
  }
  return row - 1;
}

/** The likeliest header among the first rows; `rows` holds at most thirteen. */
function detectHeaderRow(rows: string[][]): number {
  const candidates = rows.slice(0, Math.min(12, Math.max(1, rows.length - 1)));
  let bestIndex = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const [index, row] of candidates.entries()) {
    const nonempty = row.map((value) => value.trim()).filter(Boolean);
    if (nonempty.length < 2) continue;
    const unique = new Set(nonempty.map((value) => value.toLocaleLowerCase("pt"))).size;
    const next = rows[index + 1] ?? [];
    const nextNonempty = next.filter((value) => value.trim() !== "").length;
    const widthCompatibility = Math.min(nonempty.length, nextNonempty) / Math.max(nonempty.length, nextNonempty, 1);
    const duplicatePenalty = nonempty.length - unique;
    const score = nonempty.length * 3 + widthCompatibility * 20 - duplicatePenalty * 5;
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }
  return bestIndex;
}

function uniqueHeaders(values: string[]): string[] {
  const seen = new Map<string, number>();
  return values.map((raw, index) => {
    const base = raw.replace(/^\uFEFF/, "").trim() || `column_${index + 1}`;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });
}

function rowToObject(headers: string[], values: string[]): JsonObject {
  return Object.fromEntries(
    headers.map((header, index) => {
      const value = values[index]?.trim();
      return [header, value === undefined || value === "" ? null : value];
    }),
  );
}

function extractJsonRecords(value: JsonValue): JsonObject[] {
  if (isJsonArray(value)) return value.filter(isJsonObject).map(flattenJsonRecord);
  if (!isJsonObject(value)) throw new Error("Tabular JSON must contain objects");
  const features = asArray(value.features);
  if (value.type === "FeatureCollection" && features !== undefined) {
    return features.filter(isJsonObject).map(featureRecord);
  }
  for (const key of ["data", "results", "items"]) {
    const nested = asArray(value[key]);
    if (nested !== undefined) return nested.filter(isJsonObject).map(flattenJsonRecord);
  }
  return [flattenJsonRecord(value)];
}

/** A GeoJSON feature as a row: its properties, its id, its point coordinates, its geometry. */
function featureRecord(feature: JsonObject): JsonObject {
  const geometry = feature.geometry ?? null;
  const record: JsonObject = { ...asObject(feature.properties) };
  if (feature.id !== undefined) record.featureId = feature.id;
  const point = pointCoordinates(geometry);
  if (point !== undefined) {
    record.longitude = point.longitude;
    record.latitude = point.latitude;
  }
  record.geometry = geometry;
  return record;
}

/** The point a GeoJSON geometry names, when it names a single one. */
function pointCoordinates(
  geometry: JsonValue,
): { longitude: number; latitude: number } | undefined {
  if (!isJsonObject(geometry) || geometry.type !== "Point") return undefined;
  const coordinates = asArrayOrEmpty(geometry.coordinates);
  const longitude = asNumber(coordinates[0]);
  const latitude = asNumber(coordinates[1]);
  return longitude === undefined || latitude === undefined
    ? undefined
    : { longitude, latitude };
}

function flattenJsonRecord(record: JsonObject): JsonObject {
  return { ...record };
}

function jsonLayout(value: JsonValue): string {
  if (isJsonArray(value)) return "array";
  if (isJsonObject(value) && value.type === "FeatureCollection") return "feature-collection";
  if (isJsonObject(value)) return "object";
  return "unknown";
}

/* ---------- Profiling the sample ---------- */

function profileColumns(
  names: string[],
  rows: Array<JsonObject>,
): ProfiledColumn[] {
  return names.map((name) => {
    const values = rows.map((row) => row[name] ?? null);
    const type = inferType(name, values, rows);
    const column: ProfiledColumn = {
      name,
      type,
      nullable: values.some((value) => isEmpty(value) || parseValue(value, type) === null),
    };
    const unit = type === "number" ? inferUnit(name) : undefined;
    if (unit !== undefined) column.unit = unit;
    const label = displayLabel(name);
    if (label !== name) column.display = { label };
    return column;
  });
}

function inferType(
  name: string,
  values: JsonValue[],
  rows: Array<JsonObject>,
): InferredType {
  const present = values.filter((value) => !isEmpty(value));
  if (present.length === 0) return "string";
  const normalizedName = normalizeName(name);
  if (isLatitudeName(normalizedName) && present.every((value) => coordinate(value, "latitude") !== null)) {
    return "latitude";
  }
  if (isLongitudeName(normalizedName) && present.every((value) => coordinate(value, "longitude") !== null)) {
    return "longitude";
  }
  if ((normalizedName === "x" || normalizedName === "y") && isPortugalCoordinateColumn(normalizedName, present, rows)) {
    return normalizedName === "x" ? "longitude" : "latitude";
  }
  if (isIdentifierName(normalizedName)) return "identifier";
  if (CATEGORY_NAME.test(normalizedName)) return "category";
  if (present.every((value) => isJsonObject(value) || isJsonArray(value))) return "json";
  if (present.every((value) => parseBoolean(value) !== null)) return "boolean";
  const urlCount = present.filter(isUrl).length;
  if (
    urlCount === present.length ||
    (URL_NAME.test(normalizedName) && urlCount / present.length >= 0.9)
  ) return "url";
  if (present.every((value) => isColor(value))) return "color";
  const dates = present.map((value) => parseDateValue(value));
  if (dates.every((value) => value !== null)) {
    return dates.some((value) => value?.includes("T")) ? "datetime" : "date";
  }
  if (present.filter((value) => parseNumber(value) !== null).length / present.length >= 0.95) return "number";
  const distinct = new Set(present.map((value) => cellText(value))).size;
  if (distinct <= MAX_DISTINCT) return "category";
  return "string";
}

function applyColorBadge(columns: ProfiledColumn[]): void {
  const color = columns.find((column) => column.type === "color");
  if (!color) return;
  const label = columns.find((column) =>
    (column.type === "string" || column.type === "category") &&
    /(^| )(name|nome|title|titulo|designacao|label|short name)( |$)/.test(normalizeName(column.name)),
  );
  if (!label) return;
  label.display = {
    ...label.display,
    badge: { colorField: color.name },
  };
}

function schemaOf(columns: ProfiledColumn[]): CanonicalSchema {
  return {
    fields: columns.map((column) => {
      const canonical: CanonicalField = {
        id: column.name,
        name: column.name,
        type: column.type,
        nullable: column.nullable,
      };
      if (column.unit !== undefined) canonical.unit = column.unit;
      if (column.display !== undefined) canonical.display = column.display;
      return canonical;
    }),
  };
}

function chooseKeyField(
  configured: string | undefined,
  columns: ProfiledColumn[],
  rows: Array<JsonObject>,
): string | undefined {
  if (configured) {
    if (!columns.some((column) => column.name === configured)) {
      throw new Error(`Configured keyField ${configured} was not found`);
    }
    return configured;
  }
  return columns.find((column) => {
    if (column.type !== "identifier") return false;
    const values = rows.map((row) => cellText(row[column.name])).filter(Boolean);
    return values.length === rows.length && new Set(values).size === values.length;
  })?.name;
}

function chooseEventTimeColumn(
  configured: string | undefined,
  columns: ProfiledColumn[],
): string | undefined {
  if (configured) {
    if (!columns.some((column) => column.name === configured)) {
      throw new Error(`Configured eventTimeField ${configured} was not found`);
    }
    return configured;
  }
  return columns.find((column) =>
    column.type === "date" ||
    column.type === "datetime" ||
    /^(ano|year|periodo|period|data)$/.test(normalizeName(column.name)),
  )?.name;
}

function countKeys(
  keyField: string | undefined,
  rows: Array<JsonObject>,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!keyField) return counts;
  for (const row of rows) {
    const value = cellText(row[keyField]);
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/* ---------- Reading one value ---------- */

function parseValue(value: JsonValue, type: InferredType): JsonValue {
  if (isEmpty(value)) return null;
  if (type === "boolean") return parseBoolean(value);
  if (type === "number") return parseNumber(value);
  if (type === "latitude") return coordinate(value, "latitude");
  if (type === "longitude") return coordinate(value, "longitude");
  if (type === "date" || type === "datetime") return parseDateValue(value);
  if (type === "json") return parseEmbeddedJson(value);
  const text = asString(value);
  return text === undefined ? String(value) : text.trim();
}

/** A cell the profiler called JSON: an embedded document, or text holding one. */
function parseEmbeddedJson(value: JsonValue): JsonValue {
  if (isJsonObject(value) || isJsonArray(value)) return value;
  try {
    return parseJson(String(value));
  } catch {
    return value;
  }
}

function parseBoolean(value: JsonValue | undefined): boolean | null {
  const flag = asBoolean(value);
  if (flag !== undefined) return flag;
  const text = asString(value);
  if (text === undefined) return null;
  const normalized = normalizeName(text);
  if (["true", "sim", "yes"].includes(normalized)) return true;
  if (["false", "nao", "no"].includes(normalized)) return false;
  return null;
}

function parseNumber(value: JsonValue | undefined): number | null {
  if (isJsonNumber(value)) return Number.isFinite(value) ? value : null;
  const text = asString(value);
  if (text === undefined) return null;
  let normalized = text.trim().replace(/[ \s]/g, "").replace(/[€%]/g, "");
  if (!/^[-+]?\d[\d.,]*$/.test(normalized)) return null;
  const comma = normalized.lastIndexOf(",");
  const dot = normalized.lastIndexOf(".");
  if (comma >= 0 && dot >= 0) {
    normalized = comma > dot
      ? normalized.replaceAll(".", "").replace(",", ".")
      : normalized.replaceAll(",", "");
  } else if (comma >= 0) {
    const commas = normalized.match(/,/g)?.length ?? 0;
    normalized = commas > 1
      ? normalized.replaceAll(",", "")
      : normalized.replace(",", ".");
  } else if ((normalized.match(/\./g)?.length ?? 0) > 1) {
    normalized = normalized.replaceAll(".", "");
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseDateValue(value: JsonValue | undefined): string | null {
  const raw = asString(value);
  if (raw === undefined) return null;
  const text = raw.trim();
  const portuguese = /^(\d{2})\/(\d{2})\/(\d{4})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(text);
  if (portuguese) {
    const [, day, month, year, hour, minute, second] = portuguese;
    const iso = hour
      ? `${year}-${month}-${day}T${hour}:${minute}:${second ?? "00"}Z`
      : `${year}-${month}-${day}`;
    return validDate(iso) ? iso : null;
  }
  if (/^\d{4}-\d{2}$/.test(text)) {
    const iso = `${text}-01`;
    return validDate(iso) ? iso : null;
  }
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return validDate(text) ? text : null;
  if (/^\d{4}-\d{2}-\d{2}[T ]/.test(text) && !Number.isNaN(Date.parse(text))) {
    return new Date(text).toISOString();
  }
  return null;
}

function parseEventTime(value: JsonValue | undefined, columnName: string): string | undefined {
  const date = parseDateValue(value);
  if (date) return date.includes("T") ? new Date(date).toISOString() : `${date}T00:00:00.000Z`;
  if (/^(ano|year)$/.test(normalizeName(columnName))) {
    const year = parseNumber(value);
    if (year !== null && Number.isInteger(year) && year >= 1900 && year <= 2200) {
      return `${year}-01-01T00:00:00.000Z`;
    }
  }
  return undefined;
}

function coordinate(value: JsonValue | undefined, kind: "latitude" | "longitude"): number | null {
  const number = parseNumber(value);
  if (number === null) return null;
  const valid = kind === "latitude"
    ? number >= PORTUGAL.minLatitude && number <= PORTUGAL.maxLatitude
    : number >= PORTUGAL.minLongitude && number <= PORTUGAL.maxLongitude;
  return valid ? number : null;
}

function isPortugalCoordinateColumn(
  name: "x" | "y",
  values: JsonValue[],
  _rows: Array<JsonObject>,
): boolean {
  const kind = name === "x" ? "longitude" : "latitude";
  return values.every((value) => coordinate(value, kind) !== null);
}

function isUrl(value: JsonValue | undefined): boolean {
  const text = asString(value);
  if (text === undefined) return false;
  try {
    const url = new URL(text.trim());
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isColor(value: JsonValue | undefined): boolean {
  const text = asString(value);
  return text !== undefined && /^#[0-9a-f]{6}$/i.test(text.trim());
}

function isIdentifierName(name: string): boolean {
  return /^(id|fid|codigo|code|identificador|identifier|cmnpc|codigo postal)$/.test(name) ||
    /(^| )(id|codigo|code)$/.test(name) ||
    /^(id|codigo|code) /.test(name) ||
    /(^|_)(id|codigo|code)$/.test(name);
}

function isLatitudeName(name: string): boolean {
  return /(^| )(lat|latitude|posicao lat)( |$)/.test(name);
}

function isLongitudeName(name: string): boolean {
  return /(^| )(lon|lng|long|longitude|posicao lng|posicao lon)( |$)/.test(name);
}

function inferUnit(name: string): string | undefined {
  const normalized = normalizeName(name);
  if (name.includes("%") || normalized.includes("percentagem") || normalized.includes("percentual")) return "percent";
  if (name.includes("€") || /(^| )(eur|euro|euros)( |$)/.test(normalized)) return "EUR";
  if (/\(t\)|(^| )(ton|tonelada|toneladas)( |$)/i.test(name)) return "tonne";
  if (/\b(ha|hectare|hectares)\b/i.test(name)) return "hectare";
  if (/\bkm2?\b/i.test(normalized)) return normalized.includes("km2") ? "square-kilometre" : "kilometre";
  if (/(^| )(ano|year)$/.test(normalized)) return "year";
  if (/\b(n|numero|quantidade|cheques|utentes|total)\b/.test(normalized)) return "count";
  return undefined;
}

function displayLabel(name: string): string {
  return name
    .replaceAll("_", " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_().,/:-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isEmpty(value: JsonValue | undefined): boolean {
  const text = asString(value);
  return value === null || value === undefined || (text !== undefined && text.trim() === "");
}

/** The text of a cell, with blanks read as the absence of a reading. */
function cellText(value: JsonValue | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  const text = asString(value);
  if (text === undefined) return String(value);
  return text.trim() === "" ? undefined : text.trim();
}

function stableRowHash(row: JsonObject): string {
  return hashString(stableStringify(row));
}

function stableStringify(value: JsonValue): string {
  if (isJsonArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isJsonObject(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}


function validDate(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function uniqueInOrder(values: string[]): string[] {
  return [...new Set(values)];
}

