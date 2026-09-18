import {
  field,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonValue,
  type ProductBuild,
  type TransformContext,
  type UnstampedResult,
} from "../../index";

const SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    field("magnitude", "number", false),
    field("place", "string", false),
    field("occurredAt", "datetime", false),
    field("updatedAt", "datetime", false),
    field("status", "category", false),
    field("type", "category", false),
    field("depth", "number", false, "km"),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("feltReports", "number", true),
    field("communityIntensity", "number", true),
    field("modifiedMercalliIntensity", "number", true),
    field("alert", "category", true),
    field("tsunami", "boolean", false),
    field("significance", "number", true),
    field("network", "category", true),
    field("details", "url", false),
    field("geometry", "geometry", false),
  ],
};

export class UsgsTransformer {
  readonly id = "usgs-earthquake-geojson";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const value = parseJsonBytes(bytes);
    if (!isJsonObject(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) throw new Error("USGS response is not a GeoJSON feature collection");
    const records = value.features.flatMap((candidate): CanonicalRecord[] => {
      const record = earthquake(candidate);
      return record ? [record] : [];
    });
    const watermark = records
      .map((record) => record.eventTime)
      .filter(isString)
      .sort()
      .at(-1);
    const product: ProductBuild = {
      productKey: "earthquakes",
      slug: context.feed.slug.replace(/-feed$/u, ""),
      title: context.feed.title,
      description: context.feed.description,
      role: "event-log",
      schema: SCHEMA,
      records,
      kind: "record",
      updateMode: "source-window",
      completeness: "complete",
    };
    if (watermark) product.watermark = watermark;
    return { products: [product], quality: { acceptedRecords: records.length, rejectedRecords: value.features.length - records.length } };
  }
}

function earthquake(value: JsonValue | undefined): CanonicalRecord | undefined {
  if (!isJsonObject(value) || !isJsonString(value.id) || !isJsonObject(value.properties) || !isJsonObject(value.geometry) || !Array.isArray(value.geometry.coordinates))
    return undefined;
  const properties = value.properties;
  const coordinates = value.geometry.coordinates;
  const longitude = coordinate(coordinates[0], -180, 180);
  const latitude = coordinate(coordinates[1], -90, 90);
  const depth = finite(coordinates[2]);
  const magnitude = finite(properties.mag);
  const place = text(properties.place);
  const occurredAt = milliseconds(properties.time);
  const updatedAt = milliseconds(properties.updated);
  const status = text(properties.status);
  const type = text(properties.type);
  const details = url(properties.url);
  const tsunami = properties.tsunami === 1 ? true : properties.tsunami === 0 ? false : undefined;
  if (
    longitude === undefined ||
    latitude === undefined ||
    depth === undefined ||
    magnitude === undefined ||
    !place ||
    !occurredAt ||
    !updatedAt ||
    !status ||
    !type ||
    !details ||
    tsunami === undefined
  )
    return undefined;
  return {
    entityKey: value.id,
    eventTime: occurredAt,
    sourcePublishedAt: updatedAt,
    payload: {
      id: value.id,
      magnitude,
      place,
      occurredAt,
      updatedAt,
      status,
      type,
      depth,
      latitude,
      longitude,
      feltReports: optionalFinite(properties.felt),
      communityIntensity: optionalFinite(properties.cdi),
      modifiedMercalliIntensity: optionalFinite(properties.mmi),
      alert: nullableText(properties.alert),
      tsunami,
      significance: optionalFinite(properties.sig),
      network: nullableText(properties.net),
      details,
      geometry: value.geometry,
    },
  };
}

function text(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" && value.length <= 500 ? value.trim() : undefined;
}

function nullableText(value: JsonValue | undefined): string | null {
  return text(value) ?? null;
}

function url(value: JsonValue | undefined): string | undefined {
  const candidate = text(value);
  if (!candidate) return undefined;
  try {
    const parsed = new URL(candidate);
    return parsed.protocol === "https:" ? parsed.toString() : undefined;
  } catch {
    return undefined;
  }
}

function finite(value: JsonValue | undefined): number | undefined {
  return isJsonNumber(value) && Number.isFinite(value) ? value : undefined;
}

function optionalFinite(value: JsonValue | undefined): number | null {
  return finite(value) ?? null;
}

function coordinate(value: JsonValue | undefined, minimum: number, maximum: number): number | undefined {
  const number = finite(value);
  return number !== undefined && number >= minimum && number <= maximum ? number : undefined;
}

function milliseconds(value: JsonValue | undefined): string | undefined {
  if (!isJsonNumber(value) || !Number.isSafeInteger(value) || value <= 0) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
