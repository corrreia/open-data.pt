import {
  GatekeeperError,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type CanonicalField,
  type CanonicalRecord,
  type CanonicalSchema,
  type FieldType,
  type JsonObject,
  type JsonValue,
  type ProductBuild,
  type SeriesPoint,
  type SourceConfig,
  type TransformContext,
  type UnstampedResult,
} from "../../index";
import { ngsiMeasures } from "./ngsi";

/**
 * A broker hands back entities whose attributes are whatever its data model
 * says; this reads them as they come, with two rules.
 *
 * The measurements are published once. An observations feed splits its
 * entities in two: a table of what each sensor *is* — where it stands, what it
 * is called, when it last spoke — and a series of what it *measured*. The
 * numbers live in the series and nowhere else, so nothing is restated, and the
 * table still answers the question a table is for, which for a city's sensor
 * network is mostly "which of these are still alive".
 *
 * The measures are named by the feed, never inferred. These entities carry
 * bearings, trip counts and spot totals alongside their readings, and a series
 * built from every numeric-looking attribute would chart a compass heading.
 */
export class NgsiTransformer {
  readonly id = "fiware-ngsi-v2";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const config = context.feed.config;
    const root = parseJsonBytes(bytes);
    if (!isJsonObject(root) || !Array.isArray(root.entities)) throw new GatekeeperError("NGSI document holds no entities", "invalid-response");
    return config.feed === "observations" ? observations(root.entities, config, context) : inventory(root.entities, config, context);
  }
}

/** One entity read into the pieces both feeds need. */
interface Entity {
  key: string;
  attributes: JsonObject;
  latitude: number | null;
  longitude: number | null;
}

/** What a pass over the broker's answer yielded: the entities it could read, and how many it could not. */
interface ReadEntities {
  kept: Entity[];
  rejected: number;
}

function entities(values: JsonValue[]): ReadEntities {
  const kept: Entity[] = [];
  let rejected = 0;
  for (const value of values) {
    if (!isJsonObject(value) || !isJsonString(value.id) || value.id === "") {
      rejected += 1;
      continue;
    }
    const attributes: JsonObject = {};
    let latitude: number | null = null;
    let longitude: number | null = null;
    for (const [name, attribute] of Object.entries(value)) {
      if (name === "id" || name === "type") continue;
      if (name === "location") {
        const centre = pointOf(attribute);
        longitude = centre?.[0] ?? null;
        latitude = centre?.[1] ?? null;
        continue;
      }
      attributes[name] = attribute;
    }
    kept.push({ key: value.id, attributes, latitude, longitude });
  }
  return { kept, rejected };
}

/** A GeoJSON point, which is how NGSI writes a location; anything else has no centre to take. */
function pointOf(value: JsonValue | undefined): [number, number] | undefined {
  if (!isJsonObject(value) || value.type !== "Point" || !Array.isArray(value.coordinates)) return undefined;
  const [longitude, latitude] = value.coordinates;
  if (!isJsonNumber(longitude) || !isJsonNumber(latitude)) return undefined;
  return [longitude, latitude];
}

function observations(values: JsonValue[], config: SourceConfig, context: TransformContext): UnstampedResult {
  const { kept, rejected } = entities(values);
  const measures = ngsiMeasures(config.measures);
  const measureNames = new Set(measures.map((measure) => measure.name));
  const timeField = config.timeField ?? "";

  const records: CanonicalRecord[] = [];
  const points: SeriesPoint[] = [];
  let undated = 0;
  for (const entity of kept) {
    const observedAt = sourceDateTime(entity.attributes[timeField]);
    // What the sensor is, which is everything except what it measured.
    const payload: JsonObject = {};
    for (const [name, attribute] of Object.entries(entity.attributes)) {
      if (measureNames.has(name) || name === timeField) continue;
      payload[name] = attribute;
    }
    payload.latitude = entity.latitude;
    payload.longitude = entity.longitude;
    payload.observedAt = observedAt ?? null;
    const record: CanonicalRecord = { entityKey: entity.key, payload };
    if (observedAt) record.eventTime = observedAt;
    records.push(record);

    if (!observedAt) {
      undated += 1;
      continue;
    }
    for (const measure of measures) {
      const value = entity.attributes[measure.name];
      if (!isJsonNumber(value)) continue;
      points.push({
        seriesKey: `${entity.key}:${measure.name}`,
        eventTime: observedAt,
        value,
        unit: measure.unit,
        dimensions: { sensor: entity.key, measure: measure.name },
      });
    }
  }

  records.sort((left, right) => left.entityKey.localeCompare(right.entityKey));
  points.sort((left, right) => left.eventTime.localeCompare(right.eventTime) || left.seriesKey.localeCompare(right.seriesKey));
  const watermark = points
    .map((point) => point.eventTime)
    .sort()
    .at(-1);
  const slug = context.feed.slug.replace(/-feed$/u, "");
  const products: ProductBuild[] = [
    {
      productKey: "sensors",
      slug: `${slug}-sensors`,
      title: `${context.feed.title}: sensors`,
      description: "Each sensor of this network: where it stands, what it is called, and the last moment it reported. The readings themselves are the series beside this.",
      role: "current-state",
      schema: recordSchema(records),
      records,
      kind: "record",
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    },
    {
      productKey: "observations",
      slug,
      title: context.feed.title,
      description: context.feed.description,
      role: "time-series",
      schema: SERIES_SCHEMA,
      points,
      kind: "series",
      updateMode: "delta",
      completeness: "complete",
    },
  ];
  if (watermark) for (const product of products) product.watermark = watermark;
  return { products, quality: { acceptedRecords: records.length + points.length, rejectedRecords: rejected + undated } };
}

function inventory(values: JsonValue[], config: SourceConfig, context: TransformContext): UnstampedResult {
  const { kept, rejected } = entities(values);
  const timeField = config.timeField;
  const records: CanonicalRecord[] = kept
    .map((entity): CanonicalRecord => {
      const record: CanonicalRecord = { entityKey: entity.key, payload: { ...entity.attributes, latitude: entity.latitude, longitude: entity.longitude } };
      const observedAt = timeField === undefined ? undefined : sourceDateTime(entity.attributes[timeField]);
      if (observedAt) record.eventTime = observedAt;
      return record;
    })
    .sort((left, right) => left.entityKey.localeCompare(right.entityKey));
  return {
    products: [
      {
        productKey: "entities",
        slug: context.feed.slug.replace(/-feed$/u, ""),
        title: context.feed.title,
        description: context.feed.description,
        role: "current-state",
        schema: recordSchema(records),
        records,
        kind: "record",
        // The broker answers for the whole type, so each reading replaces the last.
        updateMode: "authoritative-snapshot",
        completeness: "complete",
      },
    ],
    quality: { acceptedRecords: records.length, rejectedRecords: rejected },
  };
}

const SERIES_SCHEMA: CanonicalSchema = {
  fields: [
    { id: "seriesKey", name: "seriesKey", type: "identifier", nullable: false },
    { id: "eventTime", name: "eventTime", type: "datetime", nullable: false },
    { id: "value", name: "value", type: "number", nullable: false },
    { id: "unit", name: "unit", type: "category", nullable: false },
    { id: "dimensions", name: "dimensions", type: "json", nullable: false },
  ],
};

/** The schema the records actually filled, since a broker's data model is its own. */
function recordSchema(records: readonly CanonicalRecord[]): CanonicalSchema {
  const names = new Set<string>();
  for (const record of records) for (const name of Object.keys(record.payload)) names.add(name);
  const fields: CanonicalField[] = [...names].sort().map((name): CanonicalField => {
    const values = records.map((record) => record.payload[name]).filter((value) => value !== undefined && value !== null);
    return { id: name, name, type: fieldType(name, values), nullable: true };
  });
  return { fields };
}

function fieldType(name: string, values: readonly JsonValue[]): FieldType {
  if (name === "latitude") return "latitude";
  if (name === "longitude") return "longitude";
  if (name === "observedAt") return "datetime";
  if (values.length === 0) return "string";
  if (values.every(isJsonBoolean)) return "boolean";
  if (values.every(isJsonNumber)) return "number";
  if (values.every(isJsonString)) return "string";
  return "json";
}

/** The broker writes ISO instants; anything it cannot be read as is no clock at all. */
function sourceDateTime(value: JsonValue | undefined): string | undefined {
  if (!isJsonString(value) || value === "") return undefined;
  const stamp = Date.parse(value);
  if (!Number.isFinite(stamp)) return undefined;
  return new Date(stamp).toISOString();
}
