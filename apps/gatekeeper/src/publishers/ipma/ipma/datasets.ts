import {
  GatekeeperError,
  field,
  isJsonObject,
  isJsonString,
  streamCsvRecords,
  streamJsonArray,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type ProductDeclaration,
  type ProductFinalization,
  type StreamingTransform,
  type TransformContext,
} from "#/index";

export type IpmaDatasetFeed = "municipal-precipitation" | "municipal-temperature" | "shellfish-restrictions";

export function isIpmaDatasetFeed(feed: string | undefined): feed is IpmaDatasetFeed {
  return feed === "municipal-precipitation" || feed === "municipal-temperature" || feed === "shellfish-restrictions";
}

interface ClimateMeasure {
  column: string;
  key: string;
  label: string;
  unit: string;
}

// IPMA documents spatial statistics of interpolated daily grids, not station readings.
const RAIN_MEASURES: readonly ClimateMeasure[] = [
  { column: "mean_tp", key: "total-precipitation", label: "Total precipitation", unit: "mm" },
  { column: "mean_maxprate", key: "maximum-precipitation-rate", label: "Maximum precipitation rate", unit: "mm/h" },
];
const TEMPERATURE_MEASURES: readonly ClimateMeasure[] = [
  { column: "mean_mint2m", key: "minimum-temperature", label: "Minimum temperature", unit: "°C" },
  { column: "mean_meant2m", key: "mean-temperature", label: "Mean temperature", unit: "°C" },
  { column: "mean_maxt2m", key: "maximum-temperature", label: "Maximum temperature", unit: "°C" },
];
const SERIES_SCHEMA: CanonicalSchema = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};
const SHELLFISH_SCHEMA: CanonicalSchema = {
  fields: [
    field("zoneCode", "identifier", false),
    field("name", "string", false),
    field("region", "category", false),
    field("zoneType", "category", false),
    field("status", "category", false),
    field("openSpecies", "json", false),
    field("closedSpecies", "json", false),
    field("geometry", "geometry", false),
    field("latitude", "latitude", true),
    field("longitude", "longitude", true),
  ],
};

/** Streaming files use their own normalizer identity; existing IPMA products keep theirs. */
export class IpmaDatasetTransformer {
  readonly id = "ipma-published-datasets";
  readonly version = "1";

  async transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
    const feed = context.feed.config.feed;
    if (feed === "shellfish-restrictions") return shellfish(body, context);
    if (feed === "municipal-precipitation" || feed === "municipal-temperature") {
      return climate(body, context, feed === "municipal-precipitation" ? RAIN_MEASURES : TEMPERATURE_MEASURES);
    }
    throw new GatekeeperError("Unsupported IPMA dataset", "invalid-config");
  }
}

function declaration(context: TransformContext, productKey: string, kind: "series" | "record", schema: CanonicalSchema): ProductDeclaration {
  return {
    productKey,
    slug: context.feed.slug.replace(/-feed$/, ""),
    title: context.feed.title,
    description: context.feed.description,
    kind,
    schema,
    role: kind === "series" ? "time-series" : "current-state",
    updateMode: kind === "series" ? "source-window" : "authoritative-snapshot",
    completeness: "complete",
  };
}

async function climate(body: ReadableStream<Uint8Array>, context: TransformContext, measures: readonly ClimateMeasure[]): Promise<StreamingTransform> {
  const csv = streamCsvRecords(body, { delimiter: ",", maxRowBytes: 16 * 1024 });
  const header = await csv.header;
  for (const required of ["time", "zid", "zname", ...measures.map((measure) => measure.column)]) {
    if (!header.includes(required)) throw new GatekeeperError(`IPMA climate file is missing ${required}`, "invalid-response");
  }
  let accepted = 0;
  let rejected = 0;
  let watermark: string | undefined;
  const seen = new Set<string>();
  async function* rows(): AsyncGenerator<NormalizedRow> {
    for await (const row of csv.records) {
      const code = row.zid?.trim();
      const municipality = row.zname?.trim();
      const time = climateDay(row.time ?? "");
      if (!code || !/^\d{4}$/.test(code) || !municipality || !time) {
        rejected += 1;
        continue;
      }
      const identity = `${code}:${time}`;
      if (seen.has(identity)) throw new GatekeeperError("IPMA climate file repeats a municipality/day", "invalid-response");
      seen.add(identity);
      // The published scope is only a rolling 20-day window across mainland municipalities.
      if (seen.size > 20_000) throw new GatekeeperError("IPMA climate window exceeds its expected scope", "response-too-large");
      for (const measure of measures) {
        const raw = row[measure.column]?.trim();
        const value = raw ? Number(raw) : Number.NaN;
        if (!Number.isFinite(value) || value === -99 || value === -999 || value === -9999) {
          rejected += 1;
          continue;
        }
        accepted += 1;
        if (!watermark || time > watermark) watermark = time;
        yield {
          productKey: "observations",
          point: {
            seriesKey: `${code}:${measure.key}`,
            eventTime: time,
            value,
            unit: measure.unit,
            dimensions: { municipalityCode: code, municipality, measure: measure.label, spatialStatistic: "mean" },
          },
        };
      }
    }
  }
  return {
    products: [declaration(context, "observations", "series", SERIES_SCHEMA)],
    rows: rows(),
    finish: () => ({ quality: { acceptedRecords: accepted, rejectedRecords: rejected }, products: [finalization("observations", watermark)] }),
  };
}

function finalization(productKey: string, watermark: string | undefined): ProductFinalization {
  const result: ProductFinalization = { productKey };
  if (watermark) result.watermark = watermark;
  return result;
}

function climateDay(value: string): string | undefined {
  const match = /^(\d{4}-\d{2}-\d{2})[ T]00:00:00(?:\+00:00|Z)$/.exec(value.trim());
  if (!match?.[1]) return undefined;
  const time = `${match[1]}T00:00:00.000Z`;
  const stamp = Date.parse(time);
  return Number.isFinite(stamp) && new Date(stamp).toISOString() === time ? time : undefined;
}

function shellfish(body: ReadableStream<Uint8Array>, context: TransformContext): StreamingTransform {
  const document = streamJsonArray(body, ["features"], { maxElementBytes: 2 * 1024 * 1024 });
  let accepted = 0;
  let watermark: string | undefined;
  const seen = new Set<string>();
  async function* rows(): AsyncGenerator<NormalizedRow> {
    for await (const feature of document.elements) {
      const record = shellfishRecord(feature);
      if (seen.has(record.entityKey)) throw new GatekeeperError("IPMA shellfish bulletin repeats a zone", "invalid-response");
      seen.add(record.entityKey);
      if (seen.size > 2000) throw new GatekeeperError("IPMA shellfish bulletin exceeds its expected scope", "response-too-large");
      accepted += 1;
      yield { productKey: "zones", record };
    }
    const envelope = document.envelope();
    if (envelope.type !== "FeatureCollection") throw new GatekeeperError("IPMA shellfish file must be a FeatureCollection", "invalid-response");
    // Publication metadata follows features. Finalize the product clock, without
    // stamping every unchanged zone with a new bulletin date or acquisition time.
    if (isJsonString(envelope.publication_date)) {
      watermark = climateDay(`${envelope.publication_date}T00:00:00Z`);
      if (!watermark) throw new GatekeeperError("IPMA shellfish publication date is invalid", "invalid-response");
    }
  }
  return {
    products: [declaration(context, "zones", "record", SHELLFISH_SCHEMA)],
    rows: rows(),
    finish: () => ({ quality: { acceptedRecords: accepted, rejectedRecords: 0 }, products: [finalization("zones", watermark)] }),
  };
}

function requiredString(value: JsonValue | undefined, name: string): string {
  if (!isJsonString(value) || value.trim() === "") throw new GatekeeperError(`IPMA shellfish ${name} is missing`, "invalid-response");
  return value;
}

function species(value: JsonValue | undefined): JsonObject[] {
  if (!Array.isArray(value)) throw new GatekeeperError("IPMA shellfish species list is invalid", "invalid-response");
  return value.map((item) => {
    if (!isJsonObject(item)) throw new GatekeeperError("IPMA shellfish species must be an object", "invalid-response");
    requiredString(item.specie_c, "common species name");
    requiredString(item.specie_s, "scientific species name");
    return item;
  });
}

function shellfishRecord(value: JsonValue): CanonicalRecord {
  if (!isJsonObject(value) || value.type !== "Feature" || !isJsonObject(value.properties) || !isJsonObject(value.geometry)) {
    throw new GatekeeperError("IPMA shellfish zone must be a located GeoJSON feature", "invalid-response");
  }
  const properties = value.properties;
  if ((value.geometry.type !== "Polygon" && value.geometry.type !== "MultiPolygon") || !Array.isArray(value.geometry.coordinates)) {
    throw new GatekeeperError("IPMA shellfish zone geometry must be a polygon", "invalid-response");
  }
  if (!isJsonObject(properties.interdictions)) throw new GatekeeperError("IPMA shellfish zone lacks interdictions", "invalid-response");
  const code = requiredString(properties.code ?? properties.samp, "zone code");
  const point = isJsonString(properties.representative_point) ? /^POINT\s*\(\s*(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)\s*\)$/.exec(properties.representative_point) : null;
  const longitude = point?.[1] ? Number(point[1]) : null;
  const latitude = point?.[2] ? Number(point[2]) : null;
  const validPoint = longitude !== null && latitude !== null && Math.abs(longitude) <= 180 && Math.abs(latitude) <= 90;
  return {
    entityKey: code,
    payload: {
      zoneCode: code,
      name: requiredString(properties.name, "zone name"),
      region: requiredString(properties.region_name, "region"),
      zoneType: requiredString(properties.zone_type, "zone type"),
      status: requiredString(properties.status, "status"),
      openSpecies: species(properties.interdictions.open),
      closedSpecies: species(properties.interdictions.close),
      geometry: value.geometry,
      latitude: validPoint ? latitude : null,
      longitude: validPoint ? longitude : null,
    },
  };
}
