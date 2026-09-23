import {
  GatekeeperError,
  hashString,
  isJsonArray,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  streamJsonArray,
  type CanonicalField,
  type CanonicalRecord,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type ProductDeclaration,
  type ProductFinalization,
  type SeriesPoint,
  type SourceConfig,
  type StreamingSummary,
  type StreamingTransform,
  type TransformContext,
} from "#/index";
import { MAX_METADATA_BYTES, MAX_PAGE_BYTES } from "./opendatasoft";

/**
 * Rows profiled before products are declared. Decisions that change how a
 * payload is encoded (temporal text fields, the series time field and its
 * dimensions) are made over this prefix and hold for every later row; the
 * rest of the schema is settled over all rows with bounded counters.
 */
export const SAMPLE_ROWS = 5_000;
/** Serialized characters of sampled rows; the sample stops at whichever bound it reaches first. */
export const SAMPLE_CHARACTERS = 4 * 1024 * 1024;
/** Distinct text values remembered per field: enough to decide the 24-value category rule. */
const DISTINCT_LIMIT = 25;
const ENVELOPE_SLACK_BYTES = 64 * 1024;

interface OdsField {
  name: string;
  label: string;
  type: string;
  description?: string;
  annotations: JsonObject;
}

/** The metadata half of a captured document: what the records are described by. */
interface CapturedDataset {
  dataset: JsonObject;
  fields: OdsField[];
  metas: JsonObject;
}

/** Bounded counters over every row a field was read from. */
interface ColumnProfile {
  nonNull: number;
  text: number;
  colors: number;
  distinct: Set<string>;
  /** Later values of a text field locked as a date that did not read as one. */
  temporalMisses: number;
}

interface MappedField {
  source: OdsField;
  /** Provisional fields; their types are the encoding every payload follows. */
  canonical: CanonicalField[];
  profile: ColumnProfile;
}

/** One numeric measure's series product and the newest point it received. */
interface SeriesMeasure {
  measure: OdsField;
  productKey: string;
  unit: string;
  watermark?: string;
}

const SERIES_SCHEMA = {
  fields: [
    canonicalField("seriesKey", "identifier", false),
    canonicalField("eventTime", "datetime", false),
    canonicalField("value", "number", false),
    canonicalField("unit", "string", false),
    canonicalField("dimensions", "json", false),
  ],
};

const DATE_PART_NAME = /^(dia|day|mes|month|ano|year|hora|hour|time|minuto|minute|semana|week|trimestre|quarter|periodo|period|data|date)$/i;
/** Values such as 2026, 07, 31, 00:45 or 2026-07 that only restate the timestamp. */
const DATE_PART_VALUE = /^(\d{1,4}|\d{1,2}:\d{2}(:\d{2})?|\d{4}-\d{2}(-\d{2})?)$/;

export class OpendatasoftTransformer {
  readonly id = "opendatasoft-explore-v2.1";
  readonly version = "6";

  /**
   * Stream `{"dataset": <metadata>, "records": [...]}`. The metadata must come
   * before the records array, as the source writes it; the records are read
   * one at a time after a bounded profiling prefix.
   */
  async transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
    const document = streamJsonArray(body, ["records"], {
      maxElementBytes: MAX_PAGE_BYTES,
      maxEnvelopeBytes: MAX_METADATA_BYTES + ENVELOPE_SLACK_BYTES,
    });
    const elements = document.elements[Symbol.asyncIterator]();
    const sample: JsonValue[] = [];
    let sampled = 0;
    let exhausted = false;
    while (sample.length < SAMPLE_ROWS && sampled < SAMPLE_CHARACTERS) {
      const next = await elements.next();
      if (next.done) {
        exhausted = true;
        break;
      }
      sample.push(next.value);
      sampled += JSON.stringify(next.value).length;
    }
    let normalization: DatasetNormalization;
    try {
      normalization = new DatasetNormalization(
        parseCaptured(document.envelope(), exhausted),
        sample.filter(isJsonObject),
        productSlug(context.feed.slug),
        context.feed.config,
        context.feed.description,
        context.feed.title,
      );
    } catch (error) {
      await elements.return?.(undefined);
      throw error;
    }
    return {
      products: normalization.declarations(),
      rows: normalization.rows(sample, exhausted ? undefined : elements),
      finish: () => normalization.finish(),
    };
  }
}

/**
 * Everything decided about one dataset, and the counters that settle the rest
 * as rows stream past. Memory: the profiling sample, one row, per-field
 * counters, and one key per emitted series point for the duplicate collapse
 * (live fetches stop at `limit`, at most 10,000 rows; history slices at 2,000).
 */
class DatasetNormalization {
  private readonly title: string;
  private readonly description: string;
  private readonly mapped: MappedField[];
  private readonly mappedNames: Set<string>;
  private readonly metadataFields: Map<string, OdsField>;
  private readonly idFields: OdsField[];
  private readonly timeField: OdsField | undefined;
  private readonly timeType: string;
  private readonly dimensions: OdsField[];
  private readonly series: SeriesMeasure[];
  /** A dataset is published once: as its table, or as the series an example names, never both. */
  private readonly tablePublished: boolean;
  private readonly seenPoints = new Map<string, number>();
  private total = 0;
  private accepted = 0;
  private rejected = 0;
  private collapsed = 0;
  private watermark: string | undefined;

  private readonly feedSlug: string;
  private readonly config: SourceConfig;

  constructor(captured: CapturedDataset, sample: JsonObject[], feedSlug: string, config: SourceConfig, scope: string, scopedTitle: string) {
    this.feedSlug = feedSlug;
    this.config = config;
    const seriesFields = seriesNames(config.series);
    this.title = (config.timeField || config.groupBy) && scopedTitle ? scopedTitle : (text(captured.metas.title) ?? text(captured.dataset.dataset_id) ?? "Opendatasoft dataset");
    this.description = stripHtml(text(captured.metas.description) ?? "Opendatasoft dataset.") + (config.timeField || config.groupBy ? ` Scope: ${scope}` : "");
    this.mapped = buildFieldMapping(captured.fields, sample);
    applyBadgeDisplay(this.mapped.flatMap((field) => field.canonical));
    this.mappedNames = new Set(this.mapped.map((field) => field.source.name));
    this.metadataFields = new Map(captured.fields.map((field) => [field.name, field]));
    this.idFields = config.idFields
      ? configuredFields(config.idFields, captured.fields, "idFields")
      : captured.fields.filter((field) => field.annotations.id === true || field.name === "_id" || field.name === "id");
    this.timeField = config.timeField
      ? configuredFields(config.timeField, captured.fields, "timeField")[0]
      : captured.fields.find((field) => temporalType(field, sample) !== undefined && (isJsonString(field.annotations.timeserie_precision) || isLikelySeriesTimeField(field.name)));
    this.timeType = this.timeField ? (temporalType(this.timeField, sample) ?? (config.timeField ? "date" : this.timeField.type)) : "";
    this.dimensions =
      config.dimensions !== undefined
        ? configuredFields(config.dimensions, captured.fields, "dimensions")
        : this.timeField
          ? seriesDimensions(captured.fields, this.timeField, sample)
          : [];
    if (config.dimensions !== undefined && this.dimensions.some((field) => field === this.timeField || seriesFields.includes(field.name)))
      throw new GatekeeperError("Series dimensions must not include its time or measures", "invalid-config");
    for (const name of [config.monthField, config.quarterField]) if (name) configuredFields(name, captured.fields, "date part");
    const units = new Map(
      (config.units ?? "")
        .split(",")
        .filter(Boolean)
        .map((pair) => {
          const split = pair.indexOf("=");
          return [pair.slice(0, split), pair.slice(split + 1)];
        }),
    );
    for (const mapped of this.mapped) {
      const unit = units.get(mapped.source.name);
      if (!unit) continue;
      mapped.source.annotations = { ...mapped.source.annotations, unit };
      for (const field of mapped.canonical) field.unit = unit;
    }
    // Series exist only for the fields an example names. Guessing measures from
    // numeric-looking columns published days of the month and phone numbers
    // as series, and publishing table and series together restated every value.
    this.tablePublished = seriesFields.length === 0;
    this.series = seriesFields.map((name) => {
      const measure = captured.fields.find((field) => field.name === name);
      if (!measure || (measure.type !== "int" && measure.type !== "double")) {
        throw new GatekeeperError(`series field ${name} is not a numeric field of this dataset`, "invalid-config");
      }
      return { measure, productKey: `series:${measure.name}`, unit: units.get(measure.name) ?? fieldUnit(measure) ?? "value" };
    });
    if (this.series.length > 0 && !this.timeField) {
      throw new GatekeeperError("series needs a date or time field in this dataset", "invalid-config");
    }
  }

  /** The records table, or one series product per named measure. A single series is the feed's own product. */
  declarations(): ProductDeclaration[] {
    const single = this.series.length === 1;
    const records: ProductDeclaration = {
      productKey: "records",
      slug: this.feedSlug,
      title: this.title,
      description: this.description,
      role: "current-state",
      kind: "record",
      schema: { fields: structuredClone(this.mapped.flatMap((field) => field.canonical)) },
      updateMode: this.config.windowPeriods ? "source-window" : "authoritative-snapshot",
      completeness: "complete",
    };
    const declarations = this.series.map(({ measure, productKey, unit }): ProductDeclaration => ({
      productKey,
      slug: single ? this.feedSlug : seriesSlug(this.feedSlug, measure.name),
      title: single ? this.title : `${this.title} — ${measure.label}`,
      description: `${this.description} Measure: ${measure.label}.`,
      role: "time-series",
      kind: "series",
      schema: {
        fields: SERIES_SCHEMA.fields.map((field) => (field.id === "value" ? { ...field, unit } : field)),
      },
      updateMode: "delta",
      completeness: "complete",
    }));
    if (this.tablePublished) declarations.unshift(records);
    return declarations;
  }

  async *rows(sample: JsonValue[], rest: AsyncIterator<JsonValue> | undefined): AsyncGenerator<NormalizedRow> {
    try {
      for (const value of sample) yield* this.normalize(value);
      sample.length = 0;
      if (!rest) return;
      for (let next = await rest.next(); !next.done; next = await rest.next()) yield* this.normalize(next.value);
    } finally {
      await rest?.return?.(undefined);
    }
  }

  finish(): StreamingSummary {
    const fields = this.mapped.flatMap((field) => finalFields(field, this.total));
    applyBadgeDisplay(fields);
    const records: ProductFinalization = { productKey: "records", schema: { fields } };
    if (this.watermark) records.watermark = this.watermark;
    const products = this.series.map((series) => {
      const finalization: ProductFinalization = { productKey: series.productKey };
      if (series.watermark) finalization.watermark = series.watermark;
      return finalization;
    });
    if (this.tablePublished) products.unshift(records);
    return { quality: { acceptedRecords: this.accepted, rejectedRecords: this.rejected }, products };
  }

  private *normalize(value: JsonValue): Generator<NormalizedRow> {
    if (!isJsonObject(value)) {
      this.rejected += 1;
      return;
    }
    this.total += 1;
    this.admitLateFields(value);
    const payload: JsonObject = {};
    for (const mapped of this.mapped) {
      observe(mapped, value[mapped.source.name]);
      mapValue(value[mapped.source.name], mapped, payload);
    }
    const eventTime = this.timeField ? sourceEventTime(value, this.timeField.name, this.timeType, this.config) : undefined;
    // Explicit clocks and keys are a contract: incomplete identities must never silently collapse together.
    if ((this.config.timeField && !eventTime) || (this.config.idFields && this.idFields.some((field) => !nonEmptyPrimitive(value[field.name])))) {
      this.rejected += 1;
      return;
    }
    const keyParts = this.idFields
      .map((field) => value[field.name])
      .filter((part) => part !== null && part !== undefined && String(part) !== "")
      .map(String);
    const entityKey = keyParts.length > 0 ? (this.config.idFields ? JSON.stringify(keyParts) : keyParts.join("|")) : `row-${hashString(stableStringify(value))}`;
    const record: CanonicalRecord = { entityKey, payload };
    if (eventTime) {
      record.eventTime = eventTime;
      if (this.watermark === undefined || eventTime > this.watermark) this.watermark = eventTime;
    }
    this.accepted += 1;
    if (this.tablePublished) yield { productKey: "records", record };
    if (!eventTime) return;

    const dimensions: SeriesPoint["dimensions"] = {};
    for (const field of this.dimensions) {
      const dimension = value[field.name];
      if (nonEmptyPrimitive(dimension)) dimensions[field.name] = String(dimension);
    }
    const seriesKey =
      Object.entries(dimensions)
        .map(([key, item]) => `${key}=${this.config.dimensions !== undefined ? encodeURIComponent(item) : item}`)
        .join("|") || "all";
    for (const series of this.series) {
      const measured = value[series.measure.name];
      if (!isJsonNumber(measured) || !Number.isFinite(measured)) continue;
      // A series has one value per moment. Some portals publish several rows
      // for the same timestamp (E-REDES re-publishes revised quarter-hours);
      // keep the first row in source order, deterministically, and count the rest.
      const key = `${series.productKey}|${seriesKey}|${eventTime}`;
      if (this.seenPoints.has(key)) {
        if (this.config.dimensions !== undefined && this.seenPoints.get(key) !== measured) {
          throw new GatekeeperError(`Conflicting values for configured series dimensions at ${eventTime}; source revision order is unknown`, "invalid-response");
        }
        this.collapsed += 1;
        continue;
      }
      this.seenPoints.set(key, measured);
      if (series.watermark === undefined || eventTime > series.watermark) series.watermark = eventTime;
      yield { productKey: series.productKey, point: { seriesKey, eventTime, value: measured, unit: series.unit, dimensions } };
    }
  }

  /** A field first seen after the sample joins the payload from here on, nullable. */
  private admitLateFields(row: JsonObject): void {
    for (const [name, value] of Object.entries(row)) {
      if (this.mappedNames.has(name) || value === null) continue;
      const source = this.metadataFields.get(name) ?? { name, label: name, type: inferOdsType([value]), annotations: {} };
      this.mapped.push({ source, canonical: canonicalFieldsFor(source, []), profile: emptyProfile() });
      this.mappedNames.add(name);
    }
  }
}

function configuredFields(value: string, fields: OdsField[], option: string): OdsField[] {
  return seriesNames(value).map((name) => {
    const field = fields.find((candidate) => candidate.name === name);
    if (!field) throw new GatekeeperError(`${option} field ${name} is absent from dataset metadata`, "invalid-config");
    return field;
  });
}

/** Source reporting dates, including inventories with separate calendar parts. */
function sourceEventTime(row: JsonObject, name: string, type: string, config: SourceConfig): string | undefined {
  const value = row[name];
  if (!config.monthField && !config.quarterField) return normalizeEventTime(isJsonNumber(value) ? String(value) : value, type);
  const year = isJsonString(value) ? value.slice(0, 4) : String(value);
  let month = config.monthField ? Number(row[config.monthField]) : Number.NaN;
  if (config.quarterField) {
    const raw = String(row[config.quarterField]).toLowerCase();
    const quarters = ["primeiro", "segundo", "terceiro", "quarto"];
    const quarter = quarters.includes(raw) ? quarters.indexOf(raw) + 1 : Number(raw.replace(/^[tq]/, ""));
    month = (quarter - 1) * 3 + 1;
  }
  if (!/^\d{4}$/.test(year) || !Number.isInteger(month) || month < 1 || month > 12) return undefined;
  return normalizeEventTime(`${year}-${String(month).padStart(2, "0")}-01`, "date");
}

function parseCaptured(envelope: JsonObject, exhausted: boolean): CapturedDataset {
  const dataset = envelope.dataset;
  if (!isJsonObject(dataset) || (exhausted && !isJsonArray(envelope.records))) {
    throw new Error("Opendatasoft capture must contain dataset metadata before its records array");
  }
  const datasetId = dataset.dataset_id;
  const fieldsValue = dataset.fields;
  const metasValue = dataset.metas;
  if (!isJsonString(datasetId) || !Array.isArray(fieldsValue) || !isJsonObject(metasValue) || !isJsonObject(metasValue.default)) {
    throw new Error("Opendatasoft capture has invalid dataset metadata");
  }
  return { dataset, fields: fieldsValue.map(parseField), metas: metasValue.default };
}

function parseField(value: JsonValue | undefined): OdsField {
  if (!isJsonObject(value) || !isJsonString(value.name) || !isJsonString(value.type)) {
    throw new Error("Opendatasoft metadata contains an invalid field");
  }
  const description = text(value.description);
  const field: OdsField = {
    name: value.name,
    label: text(value.label) ?? value.name,
    type: value.type,
    annotations: isJsonObject(value.annotations) ? value.annotations : {},
  };
  if (description) field.description = description;
  return field;
}

function emptyProfile(): ColumnProfile {
  return { nonNull: 0, text: 0, colors: 0, distinct: new Set(), temporalMisses: 0 };
}

function buildFieldMapping(fields: OdsField[], records: Array<JsonObject>): MappedField[] {
  const known = new Set(fields.map((field) => field.name));
  const selectedFields = records.length === 0 ? fields : fields.filter((field) => records.some((record) => Object.hasOwn(record, field.name)));
  const unknownFields = [...new Set(records.flatMap((record) => Object.keys(record)))]
    .filter((name) => !known.has(name))
    .sort()
    .map((name): OdsField => ({
      name,
      label: name,
      type: inferOdsType(records.map((record) => record[name] ?? null)),
      annotations: {},
    }));

  return [...selectedFields, ...unknownFields].map((field) => ({
    source: field,
    canonical: canonicalFieldsFor(field, records),
    profile: emptyProfile(),
  }));
}

function canonicalFieldsFor(field: OdsField, records: Array<JsonObject>): CanonicalField[] {
  const nullable = records.length === 0 || records.some((record) => record[field.name] === null || record[field.name] === undefined);
  const display = field.label === field.name ? undefined : { label: field.label };
  const unit = fieldUnit(field);
  if (field.type === "geo_point_2d") {
    return [
      canonicalField(`${field.name}_latitude`, "latitude", nullable, undefined, display),
      canonicalField(`${field.name}_longitude`, "longitude", nullable, undefined, display),
    ];
  }
  const type = canonicalType(field, records);
  return [canonicalField(field.name, type, nullable, unit, display)];
}

/** The field as every row read it: nullability counted over all rows, text typing over all values. */
function finalFields(mapped: MappedField, total: number): CanonicalField[] {
  const field = mapped.source;
  const profile = mapped.profile;
  const nullable = total === 0 || profile.nonNull < total;
  const display = field.label === field.name ? undefined : { label: field.label };
  if (field.type === "geo_point_2d") {
    return [
      canonicalField(`${field.name}_latitude`, "latitude", nullable, undefined, display),
      canonicalField(`${field.name}_longitude`, "longitude", nullable, undefined, display),
    ];
  }
  const locked = mapped.canonical[0]?.type ?? "json";
  let type = locked;
  // Text typing never changes the payload, so it can wait for every value.
  if (field.type === "text" && locked !== "identifier" && locked !== "date" && locked !== "datetime") {
    type =
      colorName(field) && profile.text > 0 && profile.colors === profile.text ? "color" : field.annotations.facet === true && profile.distinct.size <= 24 ? "category" : "string";
  }
  return [canonicalField(field.name, type, nullable, fieldUnit(field), display)];
}

function observe(mapped: MappedField, value: JsonValue | undefined): void {
  if (value === null || value === undefined) return;
  const profile = mapped.profile;
  profile.nonNull += 1;
  if (!isJsonString(value) || value === "") return;
  profile.text += 1;
  if (/^#[0-9a-f]{6}$/i.test(value)) profile.colors += 1;
  if (profile.distinct.size < DISTINCT_LIMIT) profile.distinct.add(value);
  const locked = mapped.canonical[0]?.type;
  if (mapped.source.type === "text" && (locked === "date" || locked === "datetime") && normalizeDate(value) === null) {
    profile.temporalMisses += 1;
  }
}

function canonicalType(field: OdsField, records: Array<JsonObject>): CanonicalField["type"] {
  if (field.annotations.id === true || field.name === "_id" || field.name === "id") {
    return "identifier";
  }
  const temporal = temporalType(field, records);
  if (temporal) return temporal;
  switch (field.type) {
    case "int":
    case "double":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime";
    case "geo_shape":
      return "geometry";
    case "file":
    case "image":
    case "url":
      return "url";
    case "boolean":
      return "boolean";
    case "text": {
      const values = new Set(records.map((record) => record[field.name]).filter((value): value is string => isJsonString(value) && value !== ""));
      if (isColorField(field, values)) return "color";
      return field.annotations.facet === true && values.size <= 24 ? "category" : "string";
    }
    default:
      return "json";
  }
}

function mapValue(value: JsonValue | undefined, mapped: MappedField, payload: JsonObject): void {
  const field = mapped.source;
  if (field.type === "geo_point_2d") {
    const point = geoPoint(value);
    payload[`${field.name}_latitude`] = point?.latitude ?? null;
    payload[`${field.name}_longitude`] = point?.longitude ?? null;
    return;
  }
  const canonicalType = mapped.canonical[0]?.type;
  if (canonicalType === "date") {
    payload[field.name] = normalizeDate(value);
    return;
  }
  if (canonicalType === "datetime") {
    payload[field.name] = normalizeEventTime(value, "datetime") ?? null;
    return;
  }
  switch (field.type) {
    case "geo_shape":
      payload[field.name] = isJsonObject(value) && value.type === "Feature" && value.geometry !== undefined ? value.geometry : (value ?? null);
      return;
    case "file":
    case "image":
    case "url":
      payload[field.name] = sourceUrl(value);
      return;
    default:
      payload[field.name] = value ?? null;
  }
}

/**
 * Text facets that name a series rather than a moment, decided over the
 * profiling sample: date parts published as text (dia, mes, ano, time)
 * describe the moment, and keying on them makes every point its own series.
 */
function seriesDimensions(fields: OdsField[], timeField: OdsField, records: Array<JsonObject>): OdsField[] {
  return fields.filter((field) => {
    if (field === timeField || temporalType(field, records)) return false;
    if (field.type !== "text") return false;
    if (isDatePartName(field.name)) return false;
    const values = new Set(records.map((record) => record[field.name]).filter(nonEmptyPrimitive));
    if ([...values].every((value) => DATE_PART_VALUE.test(String(value)))) return false;
    return values.size > 0 && values.size <= 1_000 && [...values].every((value) => String(value).length <= 120);
  });
}

function applyBadgeDisplay(fields: CanonicalField[]): void {
  const color = fields.find((field) => field.type === "color");
  if (!color) return;
  const label =
    fields.find(
      (field) => field.id !== color.id && (field.type === "string" || field.type === "category") && /(^|_)(name|nome|title|titulo|label|designacao)(_|$)/i.test(field.id),
    ) ?? fields.find((field) => field.id !== color.id && (field.type === "string" || field.type === "category"));
  if (label) {
    label.display = {
      ...label.display,
      badge: { colorField: color.id },
    };
  }
}

function canonicalField(id: string, type: CanonicalField["type"], nullable: boolean, unit?: string, display?: CanonicalField["display"]): CanonicalField {
  const canonical: CanonicalField = { id, name: id, type, nullable };
  if (unit !== undefined) canonical.unit = unit;
  if (display !== undefined) canonical.display = display;
  return canonical;
}

function fieldUnit(field: OdsField): string | undefined {
  if (isJsonString(field.annotations.unit) && field.annotations.unit.trim() !== "") {
    return field.annotations.unit.trim();
  }
  for (const value of [field.label, field.description]) {
    if (!value) continue;
    const match = value.match(/[([]\s*([^()[\]]{1,24})\s*[)\]]\s*$/);
    if (match?.[1]) return match[1].trim();
  }
  return undefined;
}

function colorName(field: OdsField): boolean {
  return /(^|_)(color|colour|cor)(_|$)/i.test(field.name);
}

function isColorField(field: OdsField, values: Set<string>): boolean {
  return colorName(field) && values.size > 0 && [...values].every((value) => /^#[0-9a-f]{6}$/i.test(value));
}

function geoPoint(value: JsonValue | undefined): { latitude: number; longitude: number } | undefined {
  if (isJsonObject(value) && isJsonNumber(value.lat) && Number.isFinite(value.lat) && isJsonNumber(value.lon) && Number.isFinite(value.lon)) {
    return { latitude: value.lat, longitude: value.lon };
  }
  if (Array.isArray(value) && isJsonNumber(value[0]) && Number.isFinite(value[0]) && isJsonNumber(value[1]) && Number.isFinite(value[1])) {
    return { latitude: value[0], longitude: value[1] };
  }
  return undefined;
}

function sourceUrl(value: JsonValue | undefined): string | null {
  if (isJsonString(value)) return isHttpUrl(value) ? value : null;
  if (!isJsonObject(value)) return null;
  for (const candidate of [value.url, value.href]) {
    if (isJsonString(candidate) && isHttpUrl(candidate)) return candidate;
  }
  return null;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function normalizeDate(value: JsonValue | undefined): string | null {
  if (!isJsonString(value)) return null;
  if (/^\d{4}$/.test(value)) return `${value}-01-01`;
  if (/^\d{4}-\d{2}$/.test(value)) return `${value}-01`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const quarter = /^(\d{4})[TQ]([1-4])$/i.exec(value);
  if (quarter?.[1] && quarter[2]) {
    const month = String((Number(quarter[2]) - 1) * 3 + 1).padStart(2, "0");
    return `${quarter[1]}-${month}-01`;
  }
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? null : new Date(milliseconds).toISOString().slice(0, 10);
}

function temporalType(field: OdsField, records: Array<JsonObject>): "date" | "datetime" | undefined {
  if (field.type === "date" || field.type === "datetime") return field.type;
  if (field.type !== "text" || !isLikelySeriesTimeField(field.name)) return undefined;
  const values = records.map((record) => record[field.name]).filter((value): value is string => isJsonString(value) && value !== "");
  if (values.length === 0 || !values.every((value) => normalizeDate(value) !== null)) {
    return undefined;
  }
  return values.some((value) => /T\d{2}:\d{2}/.test(value)) ? "datetime" : "date";
}

/** A field naming a part of a date, such as dia_da_semana, mes or ano: never a series dimension. */
function isDatePartName(name: string): boolean {
  return name.split(/[_\s-]+/).some((token) => DATE_PART_NAME.test(token));
}

/** The fields an example names in `series`; none means the dataset is published as a table. */
function seriesNames(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter((name) => name !== "");
}

function isLikelySeriesTimeField(name: string): boolean {
  return /(^|_)(date|data|time|datetime|timestamp|period|periodo|tempo|epoca|trimestre|quarter|startdatetime|enddatetime|updatedatetime)(_|$)/i.test(name);
}

function normalizeEventTime(value: JsonValue | undefined, type: string): string | undefined {
  if (!isJsonString(value)) return undefined;
  const date = type === "date" ? normalizeDate(value) : value;
  if (!date) return undefined;
  const timestamp = type === "date" ? `${date}T00:00:00Z` : /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(date) ? `${date}Z` : date;
  const milliseconds = Date.parse(timestamp);
  return Number.isNaN(milliseconds) ? undefined : new Date(milliseconds).toISOString();
}

function inferOdsType(values: JsonValue[]): string {
  const value = values.find((candidate) => candidate !== null && candidate !== undefined);
  if (isJsonNumber(value)) return Number.isInteger(value) ? "int" : "double";
  if (isJsonBoolean(value)) return "boolean";
  if (isJsonString(value)) return "text";
  return "json";
}

function nonEmptyPrimitive(value: JsonValue | undefined): value is string | number | boolean {
  return (isJsonString(value) && value !== "") || (isJsonNumber(value) && Number.isFinite(value)) || isJsonBoolean(value);
}

function text(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" ? value.trim() : undefined;
}

function stripHtml(value: string): string {
  return value
    .replace(/<\s*br\s*\/?\s*>/gi, " ")
    .replace(/<\/(p|div|li|ul|ol|h[1-6])\s*>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function stableStringify(value: JsonValue | undefined): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (isJsonObject(value)) {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${stableStringify(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** Products are named after the feed, without the conventional "-feed" suffix. */
function productSlug(feedSlug: string): string {
  const slug = feedSlug.replace(/-feed$/, "");
  return slug === "" ? "opendatasoft-dataset" : slug;
}

const MAX_PRODUCT_SLUG = 200;

/**
 * The product slug of one measure's series. Opendatasoft cuts long field
 * names at 64 characters, sometimes right after an underscore, so the name is
 * reduced to single hyphens between letters and digits, and shortened to keep
 * the whole slug within the kernel's 200-character limit.
 */
export function seriesSlug(feedSlug: string, measureName: string): string {
  const measure = measureName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const room = MAX_PRODUCT_SLUG - feedSlug.length - "--series".length;
  const shortened = measure.slice(0, Math.max(0, room)).replace(/-+$/, "");
  return shortened === "" ? `${feedSlug}-series` : `${feedSlug}-${shortened}-series`;
}
