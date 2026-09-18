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
  type SourceConfig,
  type TransformContext,
  type UnstampedResult,
} from "../../index";

export class WfsTransformer {
  readonly id = "ogc-wfs-geojson";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const config = transformConfig(context.feed.config);
    const root = parseJsonBytes(bytes);
    if (!isJsonObject(root) || root.type !== "FeatureCollection" || !Array.isArray(root.features))
      throw new GatekeeperError("WFS artifact is not a GeoJSON feature collection", "invalid-response");
    const profiles = profile(root.features, config);
    const schema = schemaOf(profiles);
    const records: CanonicalRecord[] = [];
    let watermark: string | undefined;
    for (const candidate of root.features) {
      const record = featureRecord(candidate, config, profiles);
      if (!record) continue;
      records.push(record);
      if (record.sourcePublishedAt && (!watermark || record.sourcePublishedAt > watermark)) watermark = record.sourcePublishedAt;
    }
    const product: ProductBuild = {
      productKey: "features",
      slug: context.feed.slug.replace(/-feed$/u, ""),
      title: context.feed.title,
      description: context.feed.description,
      role: "event-log",
      schema,
      records,
      kind: "record",
      updateMode: "source-window",
      completeness: "complete",
    };
    if (watermark) product.watermark = watermark;
    return { products: [product], quality: { acceptedRecords: records.length, rejectedRecords: root.features.length - records.length } };
  }
}

interface Profile {
  field: string;
  nullable: boolean;
  values: JsonValue[];
  type: FieldType;
}

function profile(features: JsonValue[], config: SourceConfig): Profile[] {
  const names = new Set<string>();
  const numberFields = new Set(config.numberFields?.split(",") ?? []);
  const dateFields = new Set(config.dateFields?.split(",") ?? []);
  for (const feature of features) if (isJsonObject(feature) && isJsonObject(feature.properties)) for (const name of Object.keys(feature.properties)) names.add(name);
  if (names.size > 100) throw new GatekeeperError("WFS features expose more than 100 attributes", "response-too-large");
  return [...names].sort().map((field): Profile => {
    const values: JsonValue[] = [];
    for (const feature of features) {
      const properties = isJsonObject(feature) && isJsonObject(feature.properties) ? feature.properties : undefined;
      const value = properties?.[field];
      if (value !== undefined && value !== null) values.push(value);
    }
    return { field, nullable: true, values, type: inferType(field, values, numberFields, dateFields) };
  });
}

function inferType(name: string, values: JsonValue[], numberFields: ReadonlySet<string>, dateFields: ReadonlySet<string>): FieldType {
  if (numberFields.has(name)) return "number";
  if (dateFields.has(name)) return "datetime";
  if (values.length === 0) return "string";
  if (values.every(isJsonBoolean)) return "boolean";
  if (values.every(isJsonNumber)) return "number";
  if (values.every(isJsonString)) return "string";
  return "json";
}

function schemaOf(profiles: Profile[]): CanonicalSchema {
  const fields: CanonicalField[] = profiles.map((item) => ({ id: item.field, name: item.field, type: item.type, nullable: item.nullable }));
  fields.push(
    { id: "geometry", name: "geometry", type: "geometry", nullable: true },
    { id: "latitude", name: "latitude", type: "latitude", nullable: true },
    { id: "longitude", name: "longitude", type: "longitude", nullable: true },
  );
  return { fields };
}

function transformConfig(config: SourceConfig): SourceConfig {
  for (const field of ["idField", "eventTimeField", "sourcePublishedAtField", "numberFields", "dateFields"])
    if (!config[field]) throw new GatekeeperError(`WFS normalized configuration omitted ${field}`, "invalid-config");
  return config;
}

function featureRecord(value: JsonValue | undefined, config: SourceConfig, profiles: Profile[]): CanonicalRecord | undefined {
  if (!isJsonObject(value) || !isJsonObject(value.properties)) return undefined;
  const properties = value.properties;
  const key = properties[config.idField ?? ""];
  const eventTime = sourceDate(properties[config.eventTimeField ?? ""]);
  const sourcePublishedAt = sourceDate(properties[config.sourcePublishedAtField ?? ""]);
  if ((!isJsonString(key) && !isJsonNumber(key)) || String(key) === "" || !eventTime || !sourcePublishedAt) return undefined;
  const payload: JsonObject = {};
  for (const item of profiles) payload[item.field] = canonical(properties[item.field], item.type);
  const geometry = isJsonObject(value.geometry) ? value.geometry : null;
  const centre = geometryCentre(geometry);
  payload.geometry = geometry;
  payload.latitude = centre?.[1] ?? null;
  payload.longitude = centre?.[0] ?? null;
  return { entityKey: String(key), eventTime, sourcePublishedAt, payload };
}

function canonical(value: JsonValue | undefined, type: FieldType): JsonValue {
  if (value === undefined || value === null) return null;
  if (type === "number" && isJsonString(value)) {
    const text = value.trim();
    if (text === "") return null;
    const number = Number(text);
    return Number.isFinite(number) ? number : null;
  }
  if (type === "datetime" && isJsonString(value)) return sourceDate(value) ?? value;
  return value;
}

function sourceDate(value: JsonValue | undefined): string | undefined {
  if (!isJsonString(value)) return undefined;
  const match = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?Z?$/u.exec(value.trim());
  if (!match) return undefined;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const parsed = Date.parse(`${value.trim().replace(" ", "T").replace(/Z?$/u, "Z")}`);
  if (Number.isNaN(parsed)) return undefined;
  const date = new Date(parsed);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day ||
    date.getUTCHours() !== hour ||
    date.getUTCMinutes() !== minute ||
    date.getUTCSeconds() !== second
  )
    return undefined;
  return date.toISOString();
}

function geometryCentre(geometry: JsonObject | null): [number, number] | undefined {
  if (!geometry || !Array.isArray(geometry.coordinates)) return undefined;
  const points: Array<[number, number]> = [];
  collectPoints(geometry.coordinates, points);
  if (points.length === 0) return undefined;
  let minLongitude = 180;
  let maxLongitude = -180;
  let minLatitude = 90;
  let maxLatitude = -90;
  for (const [longitude, latitude] of points) {
    minLongitude = Math.min(minLongitude, longitude);
    maxLongitude = Math.max(maxLongitude, longitude);
    minLatitude = Math.min(minLatitude, latitude);
    maxLatitude = Math.max(maxLatitude, latitude);
  }
  return [rounded((minLongitude + maxLongitude) / 2), rounded((minLatitude + maxLatitude) / 2)];
}

function rounded(value: number): number {
  return Math.round(value * 10_000_000) / 10_000_000;
}

function collectPoints(value: JsonValue, points: Array<[number, number]>): void {
  if (!Array.isArray(value)) return;
  if (isJsonNumber(value[0]) && isJsonNumber(value[1])) {
    const longitude = value[0];
    const latitude = value[1];
    if (Number.isFinite(longitude) && Number.isFinite(latitude) && longitude >= -180 && longitude <= 180 && latitude >= -90 && latitude <= 90) points.push([longitude, latitude]);
    return;
  }
  for (const child of value) collectPoints(child, points);
}
