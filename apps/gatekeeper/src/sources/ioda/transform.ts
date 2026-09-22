import {
  GatekeeperError,
  field,
  isJsonNumber,
  parseJsonBytes,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonValue,
  type ProductBuild,
  type ProductRole,
  type SeriesPoint,
  type SourceConfig,
  type TransformContext,
  type UnstampedResult,
} from "../../index";
import { IODA_PAGE_LIMIT, envelope, envelopeType, number, object, sourceTime, text, validateIodaFeedConfig } from "./ioda";

/** More points than any allowed window can hold; a longer answer is a source that changed shape. */
const MAX_POINTS = 5000;

const EVENT_SCHEMA: CanonicalSchema = {
  fields: [
    field("location", "identifier", false),
    field("locationName", "string", false),
    field("startTime", "datetime", false),
    field("endTime", "datetime", false),
    field("durationSeconds", "number", false, "seconds"),
    field("datasource", "category", false),
    field("method", "category", false),
    field("score", "number", false),
  ],
};

const ALERT_SCHEMA: CanonicalSchema = {
  fields: [
    field("entityType", "category", false),
    field("entityCode", "identifier", false),
    field("entityName", "string", false),
    field("alertTime", "datetime", false),
    field("datasource", "category", false),
    field("method", "category", false),
    field("level", "category", false),
    field("condition", "category", false),
    field("value", "number", true),
    field("historyValue", "number", true),
  ],
};

const SERIES_SCHEMA: CanonicalSchema = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};

/**
 * The datasources published as series, each with the unit `/v2/datasources/`
 * gives it. The ones left out carry a list of per-probe or per-team objects
 * rather than a measurement (`ping-slash24-loss`, `ping-slash24-latency`,
 * `gtr-sarima` and the `upstream-delay-*` pair), and `gtr` is the same Google
 * observation `gtr-norm` already reports normalized: publishing both would
 * restate one value twice.
 */
const PUBLISHED_DATASOURCES = new Map<string, string>([
  ["bgp", "visible /24s"],
  ["ping-slash24", "responding /24s"],
  ["merit-nt", "unique source IPs"],
  ["gtr-norm", "normalized traffic"],
  ["mozilla", "%"],
]);

export class IodaTransformer {
  readonly id = "ioda-json";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const config = validateIodaFeedConfig(context.feed.config);
    const root = envelope(parseJsonBytes(bytes), envelopeType(config.feed));
    const rows = Array.isArray(root.data) ? root.data : [];
    if (config.feed === "signals") return signals(rows, config, context);
    return config.feed === "outage-events" ? events(rows, config, context) : alerts(rows, config, context);
  }
}

/** The entity every row of a feed must belong to, as IODA spells it. */
interface IodaEntity {
  type: string;
  code: string;
}

function entityOf(config: SourceConfig): IodaEntity {
  const type = config.entityType ?? "";
  const code = config.entityCode ?? "";
  if (!type || !code) throw new GatekeeperError("IODA feed configuration lost its entity", "invalid-config");
  return { type, code };
}

function common(context: TransformContext, productKey: string, role: ProductRole, schema: CanonicalSchema): Omit<ProductBuild, "kind" | "records" | "points"> {
  return {
    productKey,
    slug: context.feed.slug.replace(/-feed$/, ""),
    title: context.feed.title,
    description: context.feed.description,
    role,
    schema,
    // The window slides, so what an older collection reported and this one does
    // not is expiry, never a retraction.
    updateMode: "source-window",
    completeness: "complete",
  };
}

function events(rows: JsonValue[], config: SourceConfig, context: TransformContext): UnstampedResult {
  const entity = entityOf(config);
  const records: CanonicalRecord[] = [];
  const seen = new Set<string>();
  let watermark: string | undefined;
  for (const row of rows) {
    const event = object(row);
    const location = text(event.location, "event location");
    if (!location.startsWith(`${entity.type}/`)) throw new GatekeeperError("IODA returned an event outside the requested entity type", "invalid-response");
    const start = sourceTime(event.start);
    const duration = number(event.duration, "event duration");
    if (!Number.isSafeInteger(duration) || duration <= 0) throw new GatekeeperError("IODA returned an invalid event duration", "invalid-response");
    const datasource = text(event.datasource, "event datasource");
    const method = text(event.method, "event detection method");
    // Location, start, datasource and method are what IODA keys an event by;
    // the score and duration of an outage still running change under that key.
    const entityKey = `${location}|${datasource}|${method}|${start}`;
    if (seen.has(entityKey)) continue;
    seen.add(entityKey);
    const endTime = new Date(Date.parse(start) + duration * 1000).toISOString();
    records.push({
      entityKey,
      eventTime: start,
      validFrom: start,
      validTo: endTime,
      payload: {
        location,
        locationName: text(event.location_name, "event location name"),
        startTime: start,
        endTime,
        durationSeconds: duration,
        datasource,
        method,
        score: number(event.score, "event score"),
      },
    });
    if (!watermark || start > watermark) watermark = start;
  }
  const product: ProductBuild = { ...common(context, "outages", "event-log", EVENT_SCHEMA), kind: "record", records };
  if (watermark) product.watermark = watermark;
  // A full page means the window held at least as many events as one request reports.
  if (rows.length >= IODA_PAGE_LIMIT) product.completeness = "partial";
  return { products: [product], quality: { acceptedRecords: records.length, rejectedRecords: 0 } };
}

function alerts(rows: JsonValue[], config: SourceConfig, context: TransformContext): UnstampedResult {
  const entity = entityOf(config);
  const records: CanonicalRecord[] = [];
  const seen = new Set<string>();
  let watermark: string | undefined;
  for (const row of rows) {
    const alert = object(row);
    const subject = object(alert.entity);
    const entityType = text(subject.type, "alert entity type");
    const entityCode = text(subject.code, "alert entity code");
    if (entityType !== entity.type || entityCode !== entity.code) throw new GatekeeperError("IODA returned an alert outside the requested entity", "invalid-response");
    const alertTime = sourceTime(alert.time);
    const datasource = text(alert.datasource, "alert datasource");
    const method = text(alert.method, "alert detection method");
    const entityKey = `${entityType}/${entityCode}|${datasource}|${method}|${alertTime}`;
    if (seen.has(entityKey)) continue;
    seen.add(entityKey);
    records.push({
      entityKey,
      eventTime: alertTime,
      payload: {
        entityType,
        entityCode,
        entityName: text(subject.name, "alert entity name"),
        alertTime,
        datasource,
        method,
        level: text(alert.level, "alert level"),
        condition: text(alert.condition, "alert condition"),
        value: optionalNumber(alert.value, "alert value"),
        historyValue: optionalNumber(alert.historyValue, "alert history value"),
      },
    });
    if (!watermark || alertTime > watermark) watermark = alertTime;
  }
  const product: ProductBuild = { ...common(context, "alerts", "event-log", ALERT_SCHEMA), kind: "record", records };
  if (watermark) product.watermark = watermark;
  if (rows.length >= IODA_PAGE_LIMIT) product.completeness = "partial";
  return { products: [product], quality: { acceptedRecords: records.length, rejectedRecords: 0 } };
}

function signals(rows: JsonValue[], config: SourceConfig, context: TransformContext): UnstampedResult {
  const entity = entityOf(config);
  const points: SeriesPoint[] = [];
  const seen = new Set<string>();
  let watermark: string | undefined;
  for (const group of rows) {
    if (!Array.isArray(group)) throw new GatekeeperError("IODA returned a signal group that is not a list", "invalid-response");
    for (const row of group) {
      const series = object(row);
      if (text(series.entityType, "signal entity type") !== entity.type || text(series.entityCode, "signal entity code") !== entity.code)
        throw new GatekeeperError("IODA returned a signal outside the requested entity", "invalid-response");
      const datasource = text(series.datasource, "signal datasource");
      const unit = PUBLISHED_DATASOURCES.get(datasource);
      // A datasource whose values are per-probe objects rather than one
      // measurement is not republished; see PUBLISHED_DATASOURCES.
      if (unit === undefined) continue;
      const values = series.values;
      if (!Array.isArray(values)) throw new GatekeeperError("IODA returned a signal without values", "invalid-response");
      const from = number(series.from, "signal window start");
      const until = number(series.until, "signal window end");
      const step = number(series.step, "signal step");
      if (!Number.isSafeInteger(step) || step <= 0 || (until - from) / step !== values.length)
        throw new GatekeeperError("IODA returned a signal whose values do not fill its window", "invalid-response");
      const subtype = series.subtype === "" || series.subtype === null || series.subtype === undefined ? "" : text(series.subtype, "signal subtype");
      const seriesKey = subtype ? `${datasource}.${subtype}` : datasource;
      const dimensions: SeriesPoint["dimensions"] = { datasource, entityType: entity.type, entityCode: entity.code };
      if (subtype) dimensions.subtype = subtype;
      for (const [index, value] of values.entries()) {
        // A bin IODA holds no measurement for is left out rather than published
        // as a zero; it becomes a point of its own once the source fills it in.
        if (value === null) continue;
        if (!isJsonNumber(value) || !Number.isFinite(value)) throw new GatekeeperError(`IODA returned a non-numeric ${datasource} value`, "invalid-response");
        // The bin's own start, from the source's clock, never the poll time.
        const eventTime = sourceTime(from + index * step);
        const key = `${seriesKey}|${eventTime}`;
        if (seen.has(key)) continue;
        if (seen.size >= MAX_POINTS) throw new GatekeeperError("IODA signal output exceeds its window", "response-too-large");
        seen.add(key);
        points.push({ seriesKey, eventTime, value, unit, dimensions });
        if (!watermark || eventTime > watermark) watermark = eventTime;
      }
    }
  }
  const product: ProductBuild = { ...common(context, "signals", "time-series", SERIES_SCHEMA), kind: "series", points };
  if (watermark) product.watermark = watermark;
  return { products: [product], quality: { acceptedRecords: points.length, rejectedRecords: 0 } };
}

function optionalNumber(value: JsonValue | undefined, name: string): number | null {
  return value === null || value === undefined ? null : number(value, name);
}
