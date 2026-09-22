import {
  asArray,
  isJsonArray,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  field as canonicalField,
  parseJson,
  streamCsvRows,
  streamJsonArray,
  streamNdjson,
  type CanonicalField,
  type CanonicalRecord,
  type FieldType,
  type JsonArrayStream,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type ProductDeclaration,
  type ProductFinalization,
  type StreamingTransform,
  type TransformContext,
} from "../../index";
import type { CkanResourceMetadata } from "./ckan";
import { csvSeriesOptions, transformCkanCsvSeries } from "./csv-series";

/** The normalizer identity stamped on checkpoints; bumped whenever its output changes meaning. */
export const CKAN_NORMALIZER = { id: "ckan-resource", version: "6" } as const;

/** Portals often name a resource after its file format ("Ciclovias - GeoJSON"); the format is not what the data is. */
const FORMAT_SUFFIX = /\s*[-–—:|]\s*(geojson|json|csv|xlsx?|shp|shapefile|kmz|kml|wms|wfs|api|zip|xml)\s*$/i;

/** A resource's name without a trailing file format; the name as given when nothing else is left. */
export function resourceTitle(name: string): string {
  return name.replace(FORMAT_SUFFIX, "").trim() || name;
}

/** Column decisions are taken over at most this many leading rows, so memory stays bounded whatever the resource size. */
export const CKAN_SAMPLE_ROWS = 5_000;
/** ...and over at most this much row JSON. */
const SAMPLE_BYTES = 4 * 1024 * 1024;
/** Bytes read ahead of the parser to recognise the CSV dialect or the JSON layout. */
const PEEK_BYTES = 256 * 1024;
/** Largest single CSV row, JSON row, GeoJSON feature, or DataStore record. */
const ELEMENT_BYTES = 4 * 1024 * 1024;
/** A JSON resource that is one object is one row, read whole under this cap. */
const SINGLE_OBJECT_BYTES = 4 * 1024 * 1024;

interface SourceField {
  name: string;
  providerType?: string;
  canonicalType?: FieldType;
}

/** A source row, or `null` for one the source layout itself rejects as malformed. */
type SourceRow = JsonObject | null;

/** Rows of one resource in its source layout, with the columns known before the first row. */
interface RowSource {
  sourceType: string;
  fields: SourceField[];
  rows: AsyncIterable<SourceRow>;
}

type DatePart = "end" | "start";

/** One column decision taken over the sample and replayed on every row, in order. */
type PreparationStep = { kind: "geometry"; field: string } | { kind: "structured"; field: string; multilingual: boolean; dateParts: DatePart[] };

interface PreparationPlan {
  epsg: number | undefined;
  steps: PreparationStep[];
  /** Columns once the steps ran: geometry columns removed, derived columns added. */
  fields: SourceField[];
}

type GeometryOutcome = "outline" | "point" | undefined;

/** Per-column counts over every row, for the schema reported once the stream ends. */
interface ColumnCounts {
  absent: number;
  failed: number;
}

/**
 * Stream one CKAN resource into one record product. A resource is published
 * once, as the table it is: numeric-looking columns (phone numbers, codes,
 * counts) are not guessed into time series. Column decisions (geometry,
 * structured and multilingual columns, types) are taken over a bounded leading
 * sample and then applied to every row; the schema reported by `finish` adds
 * what later rows showed (nullability, new columns).
 */
export async function transformCkan(body: ReadableStream<Uint8Array>, context: TransformContext, metadata: CkanResourceMetadata): Promise<StreamingTransform> {
  const series = csvSeriesOptions(context.feed.config);
  if (series) {
    if (metadata.source.kind !== "file" || metadata.source.format !== "csv") throw new Error("CKAN observations require a CSV distribution");
    return transformCkanCsvSeries(body, context, series);
  }
  const configuredCrs = epsgMention(context.feed.config.crs);
  const epsg = configuredCrs ?? metadataCrs(metadata);
  // GeoJSON is WGS84 unless explicitly configured otherwise; a dataset's
  // metadata may describe an original projected layer rather than its export.
  const source = await openRows(body, metadata, configuredCrs);
  const iterator = source.rows[Symbol.asyncIterator]();
  const sample: JsonObject[] = [];
  let sampleBytes = 0;
  let rejected = 0;
  let exhausted = false;
  while (sample.length < CKAN_SAMPLE_ROWS && sampleBytes < SAMPLE_BYTES) {
    const next = await iterator.next();
    if (next.done) {
      exhausted = true;
      break;
    }
    if (next.value === null) {
      rejected += 1;
      continue;
    }
    sample.push(next.value);
    sampleBytes += JSON.stringify(next.value).length;
  }

  const sourceFields = source.fields.map((sourceField) => ({ ...sourceField }));
  appendUnknownFields(sourceFields, sample);
  if (context.feed.config.idField) upsertField(sourceFields, context.feed.config.idField, "identifier");
  const plan = planPreparation(sample, sourceFields, epsg);
  const preparedSample = sample.map((row) => prepareRow(row, plan));
  sample.length = 0;
  const fields = plan.fields.map((sourceField) =>
    inferField(
      sourceField,
      preparedSample.map((row) => row[sourceField.name] ?? null),
    ),
  );
  applyColorBadge(fields);
  const table = new RecordTable(fields, context.feed.config.idField);
  const sampleRecords = preparedSample.map((row) => table.record(row));
  preparedSample.length = 0;

  const resourceId = stringValue(metadata.resource.id) ?? "resource";
  const dataset = stringValue(metadata.package.name) ?? context.feed.config.dataset ?? "dataset";
  const productSlug = context.feed.slug.replace(/-feed$/, "") || `ckan-${slugPart(dataset)}-${slugPart(resourceId)}`;
  const title = resourceTitle(stringValue(metadata.resource.name) ?? stringValue(metadata.resource.title) ?? stringValue(metadata.package.title) ?? dataset);
  const description = stringValue(metadata.resource.description) ?? stringValue(metadata.package.notes) ?? `Resource ${resourceId} from the CKAN dataset ${dataset}.`;

  const products: ProductDeclaration[] = [
    {
      productKey: "records",
      slug: productSlug,
      title,
      description,
      role: "reference",
      kind: "record",
      schema: { fields },
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    },
  ];
  function emit(record: CanonicalRecord): NormalizedRow {
    return { productKey: "records", record };
  }

  async function* rows(): AsyncGenerator<NormalizedRow> {
    try {
      for (const record of sampleRecords) yield emit(record);
      sampleRecords.length = 0;
      if (exhausted) return;
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        if (next.value === null) {
          rejected += 1;
          continue;
        }
        yield emit(table.record(prepareRow(next.value, plan)));
      }
    } finally {
      await iterator.return?.(undefined);
    }
  }

  return {
    products,
    rows: rows(),
    finish: () => {
      const recordsFinal: ProductFinalization = { productKey: "records", schema: { fields: table.schema() } };
      if (table.latestEventTime) recordsFinal.watermark = table.latestEventTime;
      return {
        quality: { acceptedRecords: table.accepted, rejectedRecords: rejected },
        products: [recordsFinal],
      };
    },
  };
}

/** The record product's columns as sampled, plus what every later row showed. */
class RecordTable {
  readonly late: CanonicalField[] = [];
  accepted = 0;
  latestEventTime: string | undefined;
  private readonly known: Set<string>;
  private readonly counts = new Map<string, ColumnCounts>();
  private readonly eventTimeField: CanonicalField | undefined;

  private readonly fields: CanonicalField[];
  private readonly idField: string | undefined;

  constructor(fields: CanonicalField[], idField?: string) {
    this.fields = fields;
    this.idField = idField;
    this.known = new Set(fields.map((column) => column.name));
    this.eventTimeField = fields.find((column) => column.type === "datetime" || column.type === "date");
  }

  record(row: JsonObject): CanonicalRecord {
    for (const name of Object.keys(row)) {
      if (this.known.has(name)) continue;
      this.known.add(name);
      this.late.push(field(name, lateFieldType(name, row[name]), true));
    }
    const payload: JsonObject = {};
    for (const column of this.fields) payload[column.name] = this.read(row, column);
    for (const column of this.late) payload[column.name] = this.read(row, column);
    const datastoreId = this.idField ? row[this.idField] : row._id;
    if (this.idField && !(isJsonString(datastoreId) && datastoreId.trim() !== "") && !isJsonNumber(datastoreId)) {
      throw new Error(`CKAN record omitted its configured identity ${this.idField}`);
    }
    const identifierField = this.fields.find((candidate) => candidate.type === "identifier" && isPresent(payload[candidate.name]));
    const entityKey = isJsonString(datastoreId) || isJsonNumber(datastoreId) ? String(datastoreId) : identifierField ? String(payload[identifierField.name]) : stableHash(row);
    const record: CanonicalRecord = { entityKey, payload };
    const eventTime = this.eventTimeField ? eventTimeValue(payload[this.eventTimeField.name], this.eventTimeField.type) : undefined;
    if (eventTime) {
      record.eventTime = eventTime;
      if (this.latestEventTime === undefined || eventTime > this.latestEventTime) this.latestEventTime = eventTime;
    }
    this.accepted += 1;
    return record;
  }

  /** Sampled columns become nullable when any later row lacked them; late columns follow. */
  schema(): CanonicalField[] {
    return [
      ...this.fields.map((column) => ({
        ...column,
        nullable: column.nullable || (this.counts.get(column.name)?.absent ?? 0) > 0,
      })),
      ...this.late,
    ];
  }

  private read(row: JsonObject, column: CanonicalField): JsonValue {
    const raw = row[column.name];
    const value = canonicalValue(raw, column.type);
    let counts = this.counts.get(column.name);
    if (!counts) {
      counts = { absent: 0, failed: 0 };
      this.counts.set(column.name, counts);
    }
    if (!isPresent(raw)) counts.absent += 1;
    else if (value === null) counts.failed += 1;
    return value;
  }
}

/** A column first seen after the sample: its name decides, then its first value. */
function lateFieldType(name: string, value: JsonValue | undefined): FieldType {
  if (isLatitudeName(name)) return "latitude";
  if (isLongitudeName(name)) return "longitude";
  if (name === "geometry") return "geometry";
  if (isIdentifierName(name)) return "identifier";
  if (isJsonObject(value) || isJsonArray(value)) return "json";
  if (isJsonNumber(value)) return "number";
  if (isJsonBoolean(value)) return "boolean";
  return "string";
}

/* ---------- Source layouts ---------- */

async function openRows(body: ReadableStream<Uint8Array>, metadata: CkanResourceMetadata, epsg?: number): Promise<RowSource> {
  const source = metadata.source;
  if (source.kind === "datastore") return datastoreRows(body, source.fields);
  if (source.format === "csv") return csvRows(body);
  if (source.format === "geojson") return geoJsonRows(body, true, epsg);
  return jsonRows(body, epsg);
}

/** The Gatekeeper's own NDJSON of DataStore records, with the DataStore's declared fields. */
function datastoreRows(body: ReadableStream<Uint8Array>, fields: JsonValue[]): RowSource {
  const sourceFields: SourceField[] = [];
  for (const value of fields) {
    if (!isJsonObject(value)) throw new Error("CKAN DataStore field must be an object");
    const name = stringValue(value.id);
    if (!name) throw new Error("CKAN DataStore field omitted id");
    const sourceField: SourceField = { name };
    const providerType = stringValue(value.type);
    if (providerType) sourceField.providerType = providerType;
    sourceFields.push(sourceField);
  }
  return {
    sourceType: "ckan-datastore",
    fields: sourceFields,
    rows: objectRows(streamNdjson(body, { maxElementBytes: ELEMENT_BYTES })),
  };
}

async function* objectRows(values: AsyncIterable<JsonValue>): AsyncGenerator<SourceRow> {
  for await (const value of values) yield isJsonObject(value) ? value : null;
}

/** CSV rows keyed by the header; a row of the wrong width is rejected. */
async function csvRows(body: ReadableStream<Uint8Array>): Promise<RowSource> {
  const peeked = await peek(body, (text) => detectDelimiter(text, usesSingleQuoteDialect(text)).complete);
  const singleQuotes = usesSingleQuoteDialect(peeked.text);
  const { delimiter } = detectDelimiter(peeked.text, singleQuotes);
  const text = singleQuotes ? peeked.body.pipeThrough(singleQuotesToRfc4180(delimiter)) : peeked.body;
  const raw = streamCsvRows(text, { delimiter, maxRowBytes: ELEMENT_BYTES })[Symbol.asyncIterator]();
  const first = await raw.next();
  if (first.done) return { sourceType: "csv", fields: [], rows: noRows() };
  const header = uniqueHeaders(first.value);
  return {
    sourceType: `csv-${delimiter === ";" ? "semicolon" : "comma"}`,
    fields: header.map((name) => ({ name })),
    rows: csvObjects(raw, header),
  };
}

async function* csvObjects(raw: AsyncIterator<string[]>, header: string[]): AsyncGenerator<SourceRow> {
  try {
    while (true) {
      const next = await raw.next();
      if (next.done) return;
      const values = next.value;
      if (values.every((value) => value === "")) continue;
      yield values.length === header.length ? Object.fromEntries(header.map((name, index) => [name, emptyToNull(values[index] ?? "")])) : null;
    }
  } finally {
    await raw.return?.(undefined);
  }
}

async function* noRows(): AsyncGenerator<SourceRow> {
  // An empty CSV resource has no header and no rows.
}

/** A JSON resource: an array of rows, `{"records": [...]}`, a FeatureCollection, or one object. */
async function jsonRows(body: ReadableStream<Uint8Array>, epsg?: number): Promise<RowSource> {
  const peeked = await peek(body, (text) => layoutDecided(scanTopLevel(text)));
  const layout = scanTopLevel(peeked.text);
  if (
    layout.root === "object" &&
    layout.arrays.has("features") &&
    (layout.strings.get("type") === "FeatureCollection" || (!layout.strings.has("type") && !layout.arrays.has("records")))
  ) {
    return geoJsonRows(peeked.body, false, epsg);
  }
  if (layout.root === "array" || (layout.root === "object" && layout.arrays.has("records"))) {
    const stream = streamJsonArray(peeked.body, layout.root === "array" ? [] : ["records"], { maxElementBytes: ELEMENT_BYTES });
    return { sourceType: "json", fields: [], rows: objectRows(stream.elements) };
  }
  if (layout.root === "object") return { sourceType: "json", fields: [], rows: singleObject(peeked.body) };
  throw new Error("JSON resource must contain an object or array of objects");
}

async function* singleObject(body: ReadableStream<Uint8Array>): AsyncGenerator<SourceRow> {
  // An object root holds no top-level array, so the scanner streams nothing
  // and keeps the whole object, under its bound, as the envelope.
  const stream = streamJsonArray(body, [], { maxEnvelopeBytes: SINGLE_OBJECT_BYTES });
  const elements = stream.elements[Symbol.asyncIterator]();
  while (!(await elements.next()).done) {
    // Unreachable for an object root; drained so the envelope completes.
  }
  yield stream.envelope();
}

function geoJsonRows(body: ReadableStream<Uint8Array>, requireCollection: boolean, epsg?: number): RowSource {
  const stream = streamJsonArray(body, ["features"], { maxElementBytes: ELEMENT_BYTES });
  return { sourceType: "geojson-feature-collection", fields: [], rows: featureRows(stream, requireCollection, epsg) };
}

async function* featureRows(stream: JsonArrayStream, requireCollection: boolean, epsg?: number): AsyncGenerator<SourceRow> {
  for await (const feature of stream.elements) yield featureRow(feature, epsg);
  const envelope = stream.envelope();
  const declaredCrs = findMetadataCrs(envelope.crs);
  if (declaredCrs && declaredCrs !== (epsg ?? 4326)) throw new Error("GeoJSON CRS does not match the configured coordinate system");
  if (requireCollection && (envelope.type !== "FeatureCollection" || !isJsonArray(envelope.features))) {
    throw new Error("GeoJSON resource must be a FeatureCollection");
  }
}

function featureRow(feature: JsonValue, epsg?: number): SourceRow {
  if (!isJsonObject(feature) || feature.type !== "Feature" || (feature.geometry !== null && !isJsonObject(feature.geometry))) return null;
  const properties = isJsonObject(feature.properties) ? { ...feature.properties } : {};
  if (properties.id === undefined && (isJsonNumber(feature.id) || isJsonString(feature.id))) properties.id = feature.id;
  const geometry = isJsonObject(feature.geometry) ? geoJsonGeometry(feature.geometry, epsg) : null;
  if (geometry === undefined) return null;
  const centroid = geometry ? geometryCentroid(geometry) : undefined;
  return {
    ...properties,
    geometry,
    centroidLatitude: centroid?.latitude ?? null,
    centroidLongitude: centroid?.longitude ?? null,
  };
}

/** Explicit CRS supports projected municipal exports without buffering a feature collection. */
function geoJsonGeometry(geometry: JsonObject, epsg?: number): JsonObject | undefined {
  if (geometry.type === "GeometryCollection") {
    if (!isJsonArray(geometry.geometries)) return undefined;
    const geometries: JsonObject[] = [];
    for (const child of geometry.geometries) {
      if (!isJsonObject(child)) return undefined;
      const projected = geoJsonGeometry(child, epsg);
      if (!projected) return undefined;
      geometries.push(projected);
    }
    return { type: geometry.type, geometries };
  }
  if (!isJsonString(geometry.type) || !["Point", "MultiPoint", "LineString", "MultiLineString", "Polygon", "MultiPolygon"].includes(geometry.type)) return undefined;
  const coordinates = mapCoordinates(geometry.coordinates, epsg ?? 4326, true);
  if (coordinates === undefined) return undefined;
  const result: JsonObject = { ...geometry, coordinates: epsg === 3763 ? coordinates : (geometry.coordinates ?? coordinates) };
  if (epsg === 3763) {
    // A source-space bounding box or CRS would contradict the transformed coordinates.
    delete result.bbox;
    delete result.crs;
  }
  return result;
}

/** The first bytes of a body, decoded, and a body that still yields every byte. */
interface PeekedBody {
  text: string;
  body: ReadableStream<Uint8Array>;
}

async function peek(body: ReadableStream<Uint8Array>, enough: (text: string) => boolean): Promise<PeekedBody> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const chunks: Uint8Array[] = [];
  let text = "";
  let size = 0;
  let done = false;
  while (size < PEEK_BYTES && !enough(text)) {
    const part = await reader.read();
    if (part.done) {
      done = true;
      break;
    }
    chunks.push(part.value);
    size += part.value.byteLength;
    text += decoder.decode(part.value, { stream: true });
  }
  return {
    text,
    body: new ReadableStream<Uint8Array>({
      async pull(controller) {
        const buffered = chunks.shift();
        if (buffered) {
          controller.enqueue(buffered);
          return;
        }
        const part = done ? undefined : await reader.read();
        if (part === undefined || part.done) {
          controller.close();
          reader.releaseLock();
          return;
        }
        controller.enqueue(part.value);
      },
      cancel(reason) {
        return reader.cancel(reason);
      },
    }),
  };
}

/** What the first bytes of a JSON document reveal about its top-level members. */
interface TopLevelMembers {
  root: "array" | "object" | "other" | undefined;
  /** Members whose value is an array. */
  arrays: Set<string>;
  /** Members whose value is a string, decoded. */
  strings: Map<string, string>;
  /** The root object ended within the text. */
  closed: boolean;
}

function scanTopLevel(text: string): TopLevelMembers {
  const members: TopLevelMembers = { root: undefined, arrays: new Set(), strings: new Map(), closed: false };
  let index = 0;
  while (index < text.length && /\s/.test(text[index]!)) index += 1;
  if (index >= text.length) return members;
  if (text[index] !== "{") {
    members.root = text[index] === "[" ? "array" : "other";
    return members;
  }
  members.root = "object";
  let depth = 0;
  let expectKey = false;
  let afterColon = false;
  let key: string | undefined;
  for (; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      const end = closingQuote(text, index);
      if (end < 0) return members;
      if (depth === 1) {
        const literal = jsonStringLiteral(text.slice(index, end + 1));
        if (expectKey) {
          key = literal;
          expectKey = false;
        } else if (afterColon && key !== undefined && literal !== undefined) {
          members.strings.set(key, literal);
        }
      }
      afterColon = false;
      index = end;
      continue;
    }
    if (character === " " || character === "\n" || character === "\r" || character === "\t") continue;
    if (character === "{" || character === "[") {
      if (depth === 1 && afterColon && character === "[" && key !== undefined) members.arrays.add(key);
      depth += 1;
      afterColon = false;
      if (depth === 1) expectKey = true;
      continue;
    }
    if (character === "}" || character === "]") {
      depth -= 1;
      if (depth === 0) {
        members.closed = true;
        return members;
      }
      continue;
    }
    if (depth !== 1) continue;
    if (character === ",") expectKey = true;
    afterColon = character === ":";
  }
  return members;
}

function layoutDecided(members: TopLevelMembers): boolean {
  return members.root === "array" || members.root === "other" || members.closed || members.arrays.has("records") || (members.arrays.has("features") && members.strings.has("type"));
}

function closingQuote(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === '"') return index;
  }
  return -1;
}

function jsonStringLiteral(text: string): string | undefined {
  try {
    const value = parseJson(text);
    return isJsonString(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

type QuoteState = "double" | "double-closing" | "field-start" | "single" | "single-closing" | "unquoted";

/**
 * Rewrite the CKAN exporter's single-quote dialect ('a','it''s') into RFC 4180
 * ("a","it's") as it streams, so the shared parser reads it. A quote opens a
 * field only at its start; double-quoted fields pass through unchanged.
 */
function singleQuotesToRfc4180(delimiter: string): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let state: QuoteState = "field-start";
  const convert = (text: string): string => {
    let output = "";
    for (const character of text) {
      if (state === "single-closing") {
        if (character === "'") {
          output += "'";
          state = "single";
          continue;
        }
        output += '"';
        state = "unquoted";
      } else if (state === "double-closing") {
        if (character === '"') {
          output += '""';
          state = "double";
          continue;
        }
        output += '"';
        state = "unquoted";
      } else if (state === "single") {
        if (character === "'") state = "single-closing";
        else output += character === '"' ? '""' : character;
        continue;
      } else if (state === "double") {
        if (character === '"') state = "double-closing";
        else output += character;
        continue;
      }
      if (state === "field-start" && (character === "'" || character === '"')) {
        output += '"';
        state = character === "'" ? "single" : "double";
      } else {
        output += character;
        state = character === delimiter || character === "\n" || character === "\r" ? "field-start" : "unquoted";
      }
    }
    return output;
  };
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = convert(decoder.decode(chunk, { stream: true }));
      if (text) controller.enqueue(encoder.encode(text));
    },
    flush(controller) {
      let text = convert(decoder.decode());
      if (state === "single-closing" || state === "double-closing") text += '"';
      if (text) controller.enqueue(encoder.encode(text));
    },
  });
}

/** A CSV delimiter read from the first line, and whether that whole line was seen. */
interface DetectedDelimiter {
  delimiter: "," | ";";
  complete: boolean;
}

function detectDelimiter(text: string, allowSingleQuotes: boolean): DetectedDelimiter {
  const counts = { comma: 0, semicolon: 0 };
  let complete = false;
  let quote: '"' | "'" | undefined;
  for (let index = text.charCodeAt(0) === 0xfeff ? 1 : 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quote) {
      if (character === quote && text[index + 1] === quote) index += 1;
      else if (character === quote) quote = undefined;
      continue;
    }
    if (character === '"' || (allowSingleQuotes && character === "'")) quote = character;
    else if (character === ",") counts.comma += 1;
    else if (character === ";") counts.semicolon += 1;
    else if (character === "\n" || character === "\r") {
      complete = true;
      break;
    }
  }
  return { delimiter: counts.semicolon > counts.comma ? ";" : ",", complete };
}

/* ---------- Column preparation: decided over the sample, replayed per row ---------- */

function metadataCrs(metadata: CkanResourceMetadata): number | undefined {
  for (const value of [metadata.resource, metadata.package]) {
    const direct = findMetadataCrs(value);
    if (direct) return direct;
  }
  return undefined;
}

/**
 * Decide, over the sample, which columns hold geometries and which hold
 * structured (JSON or Python-literal) values, in the order the steps must run:
 * later decisions see the sample as earlier steps left it.
 */
function planPreparation(rows: JsonObject[], inputFields: SourceField[], epsg: number | undefined): PreparationPlan {
  const working = rows.map((row) => ({ ...row }));
  const fields = inputFields.map((sourceField) => ({ ...sourceField }));
  const steps: PreparationStep[] = [];

  for (const sourceField of fields.slice()) {
    const values = working.map((row) => row[sourceField.name]).filter(isPresent);
    const geometryColumn =
      values.length > 0 &&
      (isArcGisGeometryName(sourceField.name)
        ? values.some((value) => arcGisGeometry(value, epsg) !== undefined)
        : values.every((value) => isGenericGeometryValue(value) && arcGisGeometry(value, epsg) !== undefined));
    if (!geometryColumn) continue;
    const step: PreparationStep = { kind: "geometry", field: sourceField.name };
    steps.push(step);
    removeField(fields, sourceField.name);
    let hasPoint = false;
    let hasOutline = false;
    for (const row of working) {
      const outcome = applyStep(row, step, epsg);
      hasPoint ||= outcome === "point";
      hasOutline ||= outcome === "outline";
    }
    if (hasOutline) upsertField(fields, "geometry", "geometry");
    if (hasPoint || hasOutline) {
      upsertField(fields, "latitude", "latitude");
      upsertField(fields, "longitude", "longitude");
    }
  }

  for (const sourceField of fields.slice()) {
    if (sourceField.name === "geometry" || sourceField.canonicalType === "geometry") continue;
    const name = sourceField.name;
    const parsed = working.filter((row) => isPresent(row[name])).map((row) => structuredLiteral(row[name]));
    if (parsed.length === 0 || !parsed.every((value) => isJsonArray(value) || isJsonObject(value))) continue;
    const multilingual = parsed.every(isMultilingualList);
    if (multilingual) {
      sourceField.canonicalType = "string";
      upsertField(fields, `${name}_i18n`, "json", name);
    } else {
      sourceField.canonicalType = "json";
    }
    const dateParts = (["start", "end"] as const).filter((part) =>
      working.every((row) => nestedDate(isPresent(row[name]) ? structuredLiteral(row[name]) : undefined, part) !== undefined),
    );
    for (const part of dateParts) upsertField(fields, `${name}_${part}`, "datetime", name);
    const step: PreparationStep = { kind: "structured", field: name, multilingual, dateParts };
    steps.push(step);
    for (const row of working) applyStep(row, step, epsg);
    if (working.some((row) => isPresent(row.latitude) && isPresent(row.longitude))) {
      upsertField(fields, "latitude", "latitude");
      upsertField(fields, "longitude", "longitude");
    }
  }
  return { epsg, steps, fields };
}

function prepareRow(row: JsonObject, plan: PreparationPlan): JsonObject {
  const prepared = { ...row };
  for (const step of plan.steps) applyStep(prepared, step, plan.epsg);
  return prepared;
}

function applyStep(row: JsonObject, step: PreparationStep, epsg: number | undefined): GeometryOutcome {
  if (step.kind === "geometry") {
    const geometry = arcGisGeometry(row[step.field], epsg);
    delete row[step.field];
    if (!geometry) return undefined;
    if (geometry.type === "Point") {
      const coordinates = coordinatePair(geometry.coordinates);
      if (!coordinates) return undefined;
      row.longitude = coordinates[0];
      row.latitude = coordinates[1];
      return "point";
    }
    row.geometry = geometry;
    const centroid = geometryCentroid(geometry);
    row.longitude = centroid?.longitude ?? null;
    row.latitude = centroid?.latitude ?? null;
    return "outline";
  }
  const value = row[step.field];
  const parsed = isPresent(value) ? structuredLiteral(value) : undefined;
  const structured = parsed !== undefined && (isJsonArray(parsed) || isJsonObject(parsed)) ? parsed : undefined;
  if (structured !== undefined) {
    if (step.multilingual) {
      row[step.field] = selectTranslation(structured);
      row[`${step.field}_i18n`] = structured;
    } else {
      row[step.field] = structured;
    }
  }
  for (const part of step.dateParts) row[`${step.field}_${part}`] = nestedDate(structured, part) ?? null;
  if (structured !== undefined && !(isPresent(row.latitude) && isPresent(row.longitude))) {
    const coordinates = nestedCoordinates(structured, epsg);
    if (coordinates) {
      row.longitude = coordinates.longitude;
      row.latitude = coordinates.latitude;
    }
  }
  return undefined;
}

interface Coordinate {
  latitude: number;
  longitude: number;
}

interface RawGeometry {
  type: "LineString" | "MultiLineString" | "MultiPoint" | "Point" | "Polygon";
  coordinates: JsonValue;
  epsg?: number;
}

function removeField(fields: SourceField[], name: string): void {
  const index = fields.findIndex((field) => field.name === name);
  if (index >= 0) fields.splice(index, 1);
}

function upsertField(fields: SourceField[], name: string, canonicalType: FieldType, after?: string): void {
  const existing = fields.find((field) => field.name === name);
  if (existing) {
    existing.canonicalType = canonicalType;
    return;
  }
  const fieldValue = { name, canonicalType };
  const afterIndex = after ? fields.findIndex((field) => field.name === after) : -1;
  if (afterIndex >= 0) fields.splice(afterIndex + 1, 0, fieldValue);
  else fields.push(fieldValue);
}

function structuredLiteral(value: JsonValue | undefined): JsonValue | undefined {
  if (Array.isArray(value) || isJsonObject(value)) return value;
  if (!isJsonString(value)) return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return undefined;
  try {
    return parseJson(trimmed);
  } catch {
    return parsePythonLiteral(trimmed);
  }
}

/** Parse the safe data subset of Python reprs. It never executes source text. */
export function parsePythonLiteral(text: string): JsonValue | null {
  let index = 0;
  const fail = Symbol("invalid-python-literal");

  const whitespace = () => {
    while (/\s/.test(text[index] ?? "")) index += 1;
  };
  const parseString = (): string | typeof fail => {
    const quote = text[index];
    if (quote !== "'" && quote !== '"') return fail;
    index += 1;
    let result = "";
    while (index < text.length) {
      const character = text[index]!;
      index += 1;
      if (character === quote) return result;
      if (character !== "\\") {
        result += character;
        continue;
      }
      if (index >= text.length) return fail;
      const escaped = text[index]!;
      index += 1;
      const simple: EscapeTable = {
        "\\": "\\",
        "'": "'",
        '"': '"',
        n: "\n",
        r: "\r",
        t: "\t",
        b: "\b",
        f: "\f",
      };
      if (Object.hasOwn(simple, escaped)) {
        result += simple[escaped];
        continue;
      }
      if (escaped === "u") {
        const digits = text.slice(index, index + 4);
        if (!/^[0-9a-f]{4}$/i.test(digits)) return fail;
        result += String.fromCharCode(Number.parseInt(digits, 16));
        index += 4;
        continue;
      }
      result += escaped;
    }
    return fail;
  };
  const parseNumber = (): number | typeof fail => {
    const match = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(text.slice(index));
    if (!match) return fail;
    index += match[0].length;
    const value = Number(match[0]);
    return Number.isFinite(value) ? value : fail;
  };
  const parseValue = (): JsonValue | typeof fail => {
    whitespace();
    const character = text[index];
    if (character === "'" || character === '"') return parseString();
    if (character === "[") {
      index += 1;
      const values: JsonValue[] = [];
      whitespace();
      if (text[index] === "]") {
        index += 1;
        return values;
      }
      while (index < text.length) {
        const value = parseValue();
        if (value === fail) return fail;
        values.push(value);
        whitespace();
        if (text[index] === "]") {
          index += 1;
          return values;
        }
        if (text[index] !== ",") return fail;
        index += 1;
        whitespace();
        if (text[index] === "]") {
          index += 1;
          return values;
        }
      }
      return fail;
    }
    if (character === "{") {
      index += 1;
      const value: JsonObject = {};
      whitespace();
      if (text[index] === "}") {
        index += 1;
        return value;
      }
      while (index < text.length) {
        whitespace();
        const key = parseString();
        if (key === fail) return fail;
        whitespace();
        if (text[index] !== ":") return fail;
        index += 1;
        const child = parseValue();
        if (child === fail) return fail;
        value[key] = child;
        whitespace();
        if (text[index] === "}") {
          index += 1;
          return value;
        }
        if (text[index] !== ",") return fail;
        index += 1;
        whitespace();
        if (text[index] === "}") {
          index += 1;
          return value;
        }
      }
      return fail;
    }
    for (const [word, value] of [
      ["True", true],
      ["False", false],
      ["None", null],
    ] as const) {
      if (text.startsWith(word, index)) {
        index += word.length;
        return value;
      }
    }
    return parseNumber();
  };

  try {
    const value = parseValue();
    whitespace();
    return value === fail || index !== text.length ? null : value;
  } catch {
    return null;
  }
}

interface MultilingualValue extends JsonObject {
  lang: string;
  value: string;
}

function isMultilingualList(value: JsonValue | undefined): value is MultilingualValue[] {
  return Array.isArray(value) && value.length > 0 && value.every((entry) => isJsonObject(entry) && isJsonString(entry.lang) && isJsonString(entry.value));
}

function selectTranslation(value: JsonValue | undefined): string | null {
  if (!isMultilingualList(value)) return null;
  const preferred = value.find((entry) => entry.lang.toLowerCase() === "pt-pt") ?? value.find((entry) => entry.lang.toLowerCase() === "en-gb") ?? value[0];
  return isJsonString(preferred?.value) ? preferred.value : null;
}

function nestedDate(value: JsonValue | undefined, key: "end" | "start"): string | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = nestedDate(child, key);
      if (found) return found;
    }
    return undefined;
  }
  if (!isJsonObject(value)) return undefined;
  for (const [name, child] of Object.entries(value)) {
    if (name.toLowerCase() === key && isJsonString(child) && isDateTime(child)) {
      return new Date(child).toISOString();
    }
  }
  for (const child of Object.values(value)) {
    const found = nestedDate(child, key);
    if (found) return found;
  }
  return undefined;
}

function nestedCoordinates(value: JsonValue | undefined, epsg: number | undefined): Coordinate | undefined {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = nestedCoordinates(child, epsg);
      if (found) return found;
    }
    return undefined;
  }
  if (!isJsonObject(value)) return undefined;
  const latitude = parseFiniteNumber(value.latitude ?? value.lat);
  const longitude = parseFiniteNumber(value.longitude ?? value.lon ?? value.lng);
  if (latitude !== undefined && longitude !== undefined) {
    const pair = convertCoordinate([longitude, latitude], epsg);
    return pair ? { longitude: pair[0], latitude: pair[1] } : undefined;
  }
  for (const child of Object.values(value)) {
    const found = nestedCoordinates(child, epsg);
    if (found) return found;
  }
  return undefined;
}

function isArcGisGeometryName(name: string): boolean {
  return /^esriGeometry(?:Point|Polyline|Polygon|Multipoint)$/i.test(name);
}

function isGenericGeometryValue(value: JsonValue | undefined): boolean {
  const geometry = rawGeometry(value);
  if (!geometry) return false;
  if (geometry.type !== "Point") return true;
  const structured = structuredLiteral(value);
  if (isJsonObject(structured) && parseFiniteNumber(structured.x) !== undefined && parseFiniteNumber(structured.y) !== undefined) {
    return true;
  }
  const pair = coordinatePair(geometry.coordinates);
  return Boolean(pair && isProjectedTm06(pair));
}

function arcGisGeometry(value: JsonValue | undefined, metadataEpsg: number | undefined): JsonObject | undefined {
  const geometry = rawGeometry(value);
  if (!geometry) return undefined;
  const converted = mapCoordinates(geometry.coordinates, geometry.epsg ?? metadataEpsg);
  return converted === undefined ? undefined : { type: geometry.type, coordinates: converted };
}

function rawGeometry(value: JsonValue | undefined): RawGeometry | undefined {
  if (isJsonString(value)) {
    const match = /^\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*,\s*([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*$/i.exec(value);
    if (match) {
      const x = Number(match[1]);
      const y = Number(match[2]);
      if (Number.isFinite(x) && Number.isFinite(y)) {
        return { type: "Point", coordinates: [x, y] };
      }
    }
    const parsed = structuredLiteral(value);
    if (parsed === undefined || parsed === null) return undefined;
    return rawGeometry(parsed);
  }
  const pair = coordinatePair(value);
  if (pair) return { type: "Point", coordinates: pair };
  if (!isJsonObject(value)) return undefined;
  const epsg = spatialReferenceEpsg(value.spatialReference);
  const stamp = (geometry: RawGeometry): RawGeometry => {
    if (epsg !== undefined) geometry.epsg = epsg;
    return geometry;
  };
  const x = parseFiniteNumber(value.x);
  const y = parseFiniteNumber(value.y);
  if (x !== undefined && y !== undefined) {
    return stamp({ type: "Point", coordinates: [x, y] });
  }
  const paths = asArray(value.paths);
  if (paths !== undefined) {
    const single = paths.length === 1 ? paths[0] : undefined;
    return stamp(single === undefined ? { type: "MultiLineString", coordinates: paths } : { type: "LineString", coordinates: single });
  }
  const rings = asArray(value.rings);
  if (rings !== undefined) return stamp({ type: "Polygon", coordinates: rings });
  const points = asArray(value.points);
  if (points !== undefined) return stamp({ type: "MultiPoint", coordinates: points });
  return undefined;
}

function mapCoordinates(value: JsonValue | undefined, epsg: number | undefined, explicitCrs = false): JsonValue | undefined {
  const pair = coordinatePair(value);
  if (pair) {
    const converted = convertCoordinate(pair, epsg, explicitCrs);
    return converted && Array.isArray(value) ? [...converted, ...value.slice(2)] : converted;
  }
  if (!Array.isArray(value)) return undefined;
  const children: JsonValue[] = [];
  for (const child of value) {
    const converted = mapCoordinates(child, epsg, explicitCrs);
    if (converted === undefined) return undefined;
    children.push(converted);
  }
  return children;
}

function convertCoordinate(pair: [number, number], epsg: number | undefined, explicitCrs = false): [number, number] | undefined {
  if (explicitCrs && epsg === 3763) {
    const [x, y] = pair;
    if (x < -200_000 || x > 300_000 || y < -400_000 || y > 400_000) return undefined;
    const projected = epsg3763ToWgs84(x, y);
    return [projected.longitude, projected.latitude];
  }
  if (isWgs84(pair)) return pair;
  if (epsg !== undefined && epsg !== 3763) return undefined;
  if (!isProjectedTm06(pair)) return undefined;
  const converted = epsg3763ToWgs84(pair[0], pair[1]);
  return [converted.longitude, converted.latitude];
}

function isWgs84([longitude, latitude]: [number, number]): boolean {
  return longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90;
}

function isProjectedTm06([x, y]: [number, number]): boolean {
  return Math.abs(x) < 1_000_000 && Math.abs(y) > 90 && Math.abs(y) < 1_000_000 && x >= -200_000 && x <= 300_000 && y >= -400_000 && y <= 400_000;
}

function findMetadataCrs(value: JsonValue | undefined, key = ""): number | undefined {
  if (isJsonString(value) || isJsonNumber(value)) {
    const mentioned = epsgMention(value);
    if (mentioned) return mentioned;
    return /^(?:coordinate_system|crs|spatial|srid)$/i.test(key) ? numericEpsg(value) : undefined;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findMetadataCrs(child, key);
      if (found) return found;
    }
    return undefined;
  }
  if (!isJsonObject(value)) return undefined;
  for (const [childKey, child] of Object.entries(value)) {
    const found = findMetadataCrs(child, childKey);
    if (found) return found;
  }
  return undefined;
}

function spatialReferenceEpsg(value: JsonValue | undefined): number | undefined {
  if (!isJsonObject(value)) return epsgMention(value) ?? numericEpsg(value);
  return numericEpsg(value.latestWkid) ?? numericEpsg(value.wkid);
}

function epsgMention(value: JsonValue | undefined): number | undefined {
  if (!isJsonString(value)) return undefined;
  const match = /EPSG\s*(?::|::|\/|\s)\s*(\d{4,6})/i.exec(value);
  return match ? Number(match[1]) : undefined;
}

function numericEpsg(value: JsonValue | undefined): number | undefined {
  const numeric = isJsonNumber(value) ? value : isJsonString(value) && /^\d{4,6}$/.test(value.trim()) ? Number(value.trim()) : undefined;
  return numeric !== undefined && Number.isSafeInteger(numeric) ? numeric : undefined;
}

/** Exact inverse Transverse Mercator for EPSG:3763 (ETRS89 / Portugal TM06). */
export function epsg3763ToWgs84(x: number, y: number): Coordinate {
  const semiMajorAxis = 6_378_137;
  const flattening = 1 / 298.257_222_101;
  const eccentricitySquared = 2 * flattening - flattening * flattening;
  const secondEccentricitySquared = eccentricitySquared / (1 - eccentricitySquared);
  const latitudeOrigin = degreesToRadians(39.668_258_333_333_33);
  const longitudeOrigin = degreesToRadians(-8.133_108_333_333_334);
  const meridionalOrigin = meridionalArc(latitudeOrigin, semiMajorAxis, eccentricitySquared);
  const meridional = meridionalOrigin + y;
  const mu = meridional / (semiMajorAxis * (1 - eccentricitySquared / 4 - (3 * eccentricitySquared ** 2) / 64 - (5 * eccentricitySquared ** 3) / 256));
  const e1 = (1 - Math.sqrt(1 - eccentricitySquared)) / (1 + Math.sqrt(1 - eccentricitySquared));
  const footprint =
    mu +
    ((3 * e1) / 2 - (27 * e1 ** 3) / 32) * Math.sin(2 * mu) +
    ((21 * e1 ** 2) / 16 - (55 * e1 ** 4) / 32) * Math.sin(4 * mu) +
    ((151 * e1 ** 3) / 96) * Math.sin(6 * mu) +
    ((1097 * e1 ** 4) / 512) * Math.sin(8 * mu);
  const sine = Math.sin(footprint);
  const cosine = Math.cos(footprint);
  const tangent = Math.tan(footprint);
  const primeVerticalRadius = semiMajorAxis / Math.sqrt(1 - eccentricitySquared * sine * sine);
  const meridionalRadius = (semiMajorAxis * (1 - eccentricitySquared)) / (1 - eccentricitySquared * sine * sine) ** 1.5;
  const tangentSquared = tangent * tangent;
  const etaSquared = secondEccentricitySquared * cosine * cosine;
  const d = x / primeVerticalRadius;
  const latitude =
    footprint -
    ((primeVerticalRadius * tangent) / meridionalRadius) *
      (d ** 2 / 2 -
        ((5 + 3 * tangentSquared + 10 * etaSquared - 4 * etaSquared ** 2 - 9 * secondEccentricitySquared) * d ** 4) / 24 +
        ((61 + 90 * tangentSquared + 298 * etaSquared + 45 * tangentSquared ** 2 - 252 * secondEccentricitySquared - 3 * etaSquared ** 2) * d ** 6) / 720);
  const longitude =
    longitudeOrigin +
    (d -
      ((1 + 2 * tangentSquared + etaSquared) * d ** 3) / 6 +
      ((5 - 2 * etaSquared + 28 * tangentSquared - 3 * etaSquared ** 2 + 8 * secondEccentricitySquared + 24 * tangentSquared ** 2) * d ** 5) / 120) /
      cosine;
  return {
    latitude: radiansToDegrees(latitude),
    longitude: radiansToDegrees(longitude),
  };
}

function meridionalArc(latitude: number, semiMajorAxis: number, eccentricitySquared: number): number {
  return (
    semiMajorAxis *
    ((1 - eccentricitySquared / 4 - (3 * eccentricitySquared ** 2) / 64 - (5 * eccentricitySquared ** 3) / 256) * latitude -
      ((3 * eccentricitySquared) / 8 + (3 * eccentricitySquared ** 2) / 32 + (45 * eccentricitySquared ** 3) / 1024) * Math.sin(2 * latitude) +
      ((15 * eccentricitySquared ** 2) / 256 + (45 * eccentricitySquared ** 3) / 1024) * Math.sin(4 * latitude) -
      ((35 * eccentricitySquared ** 3) / 3072) * Math.sin(6 * latitude))
  );
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function radiansToDegrees(value: number): number {
  return (value * 180) / Math.PI;
}

function inferField(sourceField: SourceField, values: JsonValue[]): CanonicalField {
  const name = sourceField.name;
  const present = values.filter(isPresent);
  const nullable = present.length < values.length;
  const providerType = sourceField.providerType?.toLowerCase() ?? "";
  let type: FieldType;

  if (sourceField.canonicalType) type = sourceField.canonicalType;
  else if (isLatitudeName(name)) type = "latitude";
  else if (isLongitudeName(name)) type = "longitude";
  else if (name === "geometry") type = "geometry";
  else if (isIdentifierName(name)) type = "identifier";
  else if (/^(json|jsonb|array|object)/.test(providerType)) type = "json";
  else if (/^(bool|boolean)/.test(providerType)) type = "boolean";
  else if (/^(int|float|numeric|decimal|double|real)/.test(providerType)) type = "number";
  else if (/^date$/.test(providerType)) type = "date";
  else if (/^(timestamp|datetime|time)/.test(providerType)) type = "datetime";
  else type = inferValueType(present);

  return field(name, type, nullable);
}

function inferValueType(values: JsonValue[]): FieldType {
  if (values.length === 0) return "string";
  if (values.every((value) => isJsonObject(value) || Array.isArray(value))) return "json";
  if (values.every((value) => parseBoolean(value) !== undefined)) return "boolean";
  if (values.every((value) => parseFiniteNumber(value) !== undefined)) return "number";
  if (values.every((value) => isDateOnly(value))) return "date";
  if (values.every((value) => isDateTime(value))) return "datetime";
  if (values.every((value) => isJsonString(value) && /^#[0-9a-f]{6}$/i.test(value))) {
    return "color";
  }
  if (values.every(isHttpsUrl)) return "url";
  const distinct = new Set(values.map((value) => String(value))).size;
  return distinct <= 20 ? "category" : "string";
}

function canonicalValue(value: JsonValue | undefined, type: FieldType): JsonValue {
  if (!isPresent(value)) return null;
  switch (type) {
    case "latitude":
    case "longitude":
    case "number":
      return parseFiniteNumber(value) ?? null;
    case "boolean":
      return parseBoolean(value) ?? null;
    case "date":
      return isJsonString(value) && isDateOnly(value) ? value.slice(0, 10) : null;
    case "datetime": {
      if (!isJsonString(value) || !isDateTime(value)) return null;
      return new Date(value).toISOString();
    }
    case "json":
      return jsonValue(value) ?? null;
    case "geometry":
      return isJsonObject(value) ? value : null;
    case "identifier":
    case "category":
    case "color":
    case "string":
    case "url":
      return isJsonString(value) ? value : String(value);
  }
}

interface EscapeTable {
  [escape: string]: string;
}

/** Every CKAN field is shown under a label read from its name, which is all the source gives. */
function field(id: string, type: FieldType, nullable: boolean, unit?: string): CanonicalField {
  return canonicalField(id, type, nullable, unit, readableLabel(id));
}

function readableLabel(value: string): string {
  const label = value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll(/[_-]+/g, " ")
    .replaceAll(/\s+/g, " ")
    .trim();
  if (label.toLowerCase() === "id") return "ID";
  return label === "" ? value : label[0]!.toLocaleUpperCase("pt-PT") + label.slice(1);
}

function applyColorBadge(fields: CanonicalField[]): void {
  const color = fields.find((candidate) => candidate.type === "color");
  if (!color) return;
  const label =
    fields.find((candidate) => candidate.name !== color.name && (candidate.type === "string" || candidate.type === "category")) ??
    fields.find((candidate) => candidate.name !== color.name && candidate.type === "identifier");
  if (label) {
    label.display = {
      ...label.display,
      badge: { colorField: color.name },
    };
  }
}

function appendUnknownFields(fields: SourceField[], rows: JsonObject[]): void {
  const known = new Set(fields.map((sourceField) => sourceField.name));
  const unknown = new Set<string>();
  for (const row of rows) {
    for (const key of Object.keys(row)) {
      if (!known.has(key)) unknown.add(key);
    }
  }
  for (const name of [...unknown].sort()) fields.push({ name });
}

function usesSingleQuoteDialect(text: string): boolean {
  const start = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  return /^'(?:[^']|'')*'[,;\r\n]/.test(start);
}

function uniqueHeaders(values: string[]): string[] {
  const counts = new Map<string, number>();
  return values.map((value, index) => {
    const base = value.trim() || `column_${index + 1}`;
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}__${count}`;
  });
}

interface WeightedCentroid {
  longitude: number;
  latitude: number;
  weight: number;
}

function geometryCentroid(geometry: JsonObject): Coordinate | undefined {
  const weighted = weightedGeometryCentroid(geometry);
  return weighted ? { longitude: weighted.longitude, latitude: weighted.latitude } : undefined;
}

function weightedGeometryCentroid(geometry: JsonObject): WeightedCentroid | undefined {
  const type = stringValue(geometry.type);
  switch (type) {
    case "Point": {
      const point = coordinatePair(geometry.coordinates);
      return point ? { longitude: point[0], latitude: point[1], weight: 1 } : undefined;
    }
    case "MultiPoint":
      return averageCoordinates(geometry.coordinates);
    case "LineString":
      return lineCentroid(geometry.coordinates);
    case "MultiLineString":
      return combineWeighted(Array.isArray(geometry.coordinates) ? geometry.coordinates.map(lineCentroid) : []);
    case "Polygon":
      return polygonCentroid(geometry.coordinates);
    case "MultiPolygon":
      return combineWeighted(Array.isArray(geometry.coordinates) ? geometry.coordinates.map(polygonCentroid) : []);
    case "GeometryCollection":
      return combineWeighted(Array.isArray(geometry.geometries) ? geometry.geometries.filter(isJsonObject).map(weightedGeometryCentroid) : []);
    default:
      return averageCoordinates(geometry.coordinates);
  }
}

function lineCentroid(value: JsonValue | undefined): WeightedCentroid | undefined {
  if (!Array.isArray(value)) return undefined;
  const points = value.map(coordinatePair).filter((point): point is [number, number] => Boolean(point));
  if (points.length === 1) {
    return { longitude: points[0]![0], latitude: points[0]![1], weight: 1 };
  }
  const segments: WeightedCentroid[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const start = points[index - 1]!;
    const end = points[index]!;
    const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
    if (length === 0) continue;
    segments.push({
      longitude: (start[0] + end[0]) / 2,
      latitude: (start[1] + end[1]) / 2,
      weight: length,
    });
  }
  return combineWeighted(segments) ?? averageCoordinates(value);
}

function polygonCentroid(value: JsonValue | undefined): WeightedCentroid | undefined {
  if (!Array.isArray(value)) return undefined;
  const rings = value.map(ringCentroid).filter((ring): ring is WeightedCentroid => Boolean(ring));
  if (rings.length === 0) return undefined;
  const weighted = rings.map((ring, index) => ({
    ...ring,
    weight: index === 0 ? Math.abs(ring.weight) : -Math.abs(ring.weight),
  }));
  const totalWeight = weighted.reduce((total, ring) => total + ring.weight, 0);
  if (Math.abs(totalWeight) < Number.EPSILON) return rings[0];
  return {
    longitude: weighted.reduce((total, ring) => total + ring.longitude * ring.weight, 0) / totalWeight,
    latitude: weighted.reduce((total, ring) => total + ring.latitude * ring.weight, 0) / totalWeight,
    weight: Math.abs(totalWeight),
  };
}

function ringCentroid(value: JsonValue | undefined): WeightedCentroid | undefined {
  if (!Array.isArray(value)) return undefined;
  const points = value.map(coordinatePair).filter((point): point is [number, number] => Boolean(point));
  if (points.length < 3) return lineCentroid(value);
  let twiceArea = 0;
  let longitude = 0;
  let latitude = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const cross = current[0] * next[1] - next[0] * current[1];
    twiceArea += cross;
    longitude += (current[0] + next[0]) * cross;
    latitude += (current[1] + next[1]) * cross;
  }
  if (Math.abs(twiceArea) < Number.EPSILON) return lineCentroid(value);
  return {
    longitude: longitude / (3 * twiceArea),
    latitude: latitude / (3 * twiceArea),
    weight: Math.abs(twiceArea / 2),
  };
}

function averageCoordinates(value: JsonValue | undefined): WeightedCentroid | undefined {
  const pairs: Array<[number, number]> = [];
  collectCoordinatePairs(value, pairs);
  if (pairs.length === 0) return undefined;
  return {
    longitude: pairs.reduce((total, pair) => total + pair[0], 0) / pairs.length,
    latitude: pairs.reduce((total, pair) => total + pair[1], 0) / pairs.length,
    weight: pairs.length,
  };
}

function combineWeighted(values: Array<WeightedCentroid | undefined>): WeightedCentroid | undefined {
  const centroids = values.filter((value): value is WeightedCentroid => Boolean(value));
  const weight = centroids.reduce((total, centroid) => total + centroid.weight, 0);
  if (centroids.length === 0 || weight <= 0) return undefined;
  return {
    longitude: centroids.reduce((total, centroid) => total + centroid.longitude * centroid.weight, 0) / weight,
    latitude: centroids.reduce((total, centroid) => total + centroid.latitude * centroid.weight, 0) / weight,
    weight,
  };
}

function coordinatePair(value: JsonValue | undefined): [number, number] | undefined {
  if (!Array.isArray(value) || !isJsonNumber(value[0]) || !Number.isFinite(value[0]) || !isJsonNumber(value[1]) || !Number.isFinite(value[1])) {
    return undefined;
  }
  return [value[0], value[1]];
}

function collectCoordinatePairs(value: JsonValue | undefined, pairs: Array<[number, number]>): void {
  const pair = coordinatePair(value);
  if (pair) {
    pairs.push(pair);
    return;
  }
  if (!Array.isArray(value)) return;
  for (const child of value) collectCoordinatePairs(child, pairs);
}

function isLatitudeName(name: string): boolean {
  const normalized = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  return /(^|_)(lat|latitude)$/.test(normalized) || normalized === "centroidlatitude";
}

function isLongitudeName(name: string): boolean {
  const normalized = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  return /(^|_)(lon|lng|longitude)$/.test(normalized) || normalized === "centroidlongitude";
}

function isIdentifierName(name: string): boolean {
  const normalized = name.toLowerCase().replaceAll(/[^a-z0-9]+/g, "_");
  return normalized === "id" || normalized === "_id" || normalized.endsWith("_id") || ["uuid", "guid", "globalid", "objectid", "identifier"].includes(normalized);
}

function parseBoolean(value: JsonValue | undefined): boolean | undefined {
  if (isJsonBoolean(value)) return value;
  if (!isJsonString(value)) return undefined;
  switch (value.trim().toLowerCase()) {
    case "true":
    case "yes":
    case "sim":
    case "1":
      return true;
    case "false":
    case "no":
    case "não":
    case "nao":
    case "0":
      return false;
    default:
      return undefined;
  }
}

function parseFiniteNumber(value: JsonValue | undefined): number | undefined {
  if (isJsonNumber(value)) return Number.isFinite(value) ? value : undefined;
  if (!isJsonString(value) || value.trim() === "") return undefined;
  const normalized = value.trim();
  if (!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) {
    return undefined;
  }
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}

function isDateOnly(value: JsonValue | undefined): value is string {
  if (!isJsonString(value) || !/^\d{4}-\d{2}-\d{2}$/.test(value.trim())) return false;
  return !Number.isNaN(Date.parse(`${value.trim()}T00:00:00Z`));
}

function isDateTime(value: JsonValue | undefined): value is string {
  if (!isJsonString(value) || !/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value.trim())) {
    return false;
  }
  return !Number.isNaN(Date.parse(value));
}

function isHttpsUrl(value: JsonValue | undefined): value is string {
  if (!isJsonString(value)) return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function jsonValue(value: JsonValue | undefined): JsonValue | undefined {
  if (isJsonObject(value) || Array.isArray(value)) return value;
  if (!isJsonString(value)) return value;
  const trimmed = value.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return value;
  try {
    return parseJson(trimmed);
  } catch {
    return value;
  }
}

function eventTimeValue(value: JsonValue | undefined, type: FieldType): string | undefined {
  if (type === "date" && isJsonString(value) && isDateOnly(value)) {
    return `${value}T00:00:00.000Z`;
  }
  return type === "datetime" && isJsonString(value) && isDateTime(value) ? new Date(value).toISOString() : undefined;
}

function stableHash(value: JsonValue | undefined): string {
  const text = stableStringify(value);
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= BigInt(text.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

function stableStringify(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isJsonObject(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

function emptyToNull(value: string): string | null {
  return value === "" ? null : value;
}

function isPresent(value: JsonValue | undefined): boolean {
  return value !== null && value !== undefined && value !== "";
}

function stringValue(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" ? value : undefined;
}

function slugPart(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replaceAll(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, "-")
    .replaceAll(/^-|-$/g, "");
  return slug || "resource";
}
