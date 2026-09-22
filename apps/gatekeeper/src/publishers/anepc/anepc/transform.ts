import {
  field,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonObject,
  type JsonValue,
  type ProductBuild,
  type UnstampedResult,
  type TransformContext,
} from "../../../index";

const SCHEMA: CanonicalSchema = {
  fields: [
    field("occurrenceNumber", "identifier", false),
    field("sourceId", "identifier", true),
    field("status", "category", false),
    field("statusGroup", "category", false),
    field("startedAt", "datetime", false),
    field("natureCode", "identifier", false),
    field("nature", "category", false),
    field("classification", "category", false),
    field("firePhase", "category", true),
    field("region", "category", true),
    field("subregion", "category", true),
    field("municipality", "category", true),
    field("parish", "category", true),
    field("locality", "string", true),
    field("address", "string", true),
    field("groundPersonnel", "number", false, "people"),
    field("airPersonnel", "number", false, "people"),
    field("personnel", "number", false, "people"),
    field("groundResources", "number", false),
    field("airResources", "number", false),
    field("entities", "number", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("geometry", "geometry", false),
  ],
};

export class AnepcTransformer {
  readonly id = "anepc-active-occurrences";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const value = parseJsonBytes(bytes);
    if (!isJsonObject(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features)) throw new Error("ANEPC response is not a GeoJSON feature collection");
    const records = value.features.flatMap((feature): CanonicalRecord[] => {
      const record = occurrence(feature);
      return record ? [record] : [];
    });
    const watermark = records
      .map((record) => record.eventTime)
      .filter(isString)
      .sort()
      .at(-1);
    const product: ProductBuild = {
      productKey: "occurrences",
      slug: context.feed.slug.replace(/-feed$/u, ""),
      title: context.feed.title,
      description: context.feed.description,
      role: "event-log",
      schema: SCHEMA,
      records,
      kind: "record",
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    };
    if (watermark) product.watermark = watermark;
    return { products: [product], quality: { acceptedRecords: records.length, rejectedRecords: value.features.length - records.length } };
  }
}

function occurrence(value: JsonValue | undefined): CanonicalRecord | undefined {
  if (!isJsonObject(value) || !isJsonObject(value.properties) || !isJsonObject(value.geometry)) return undefined;
  const properties = value.properties;
  const occurrenceNumber = text(properties.Numero);
  const status = text(properties.EstadoOcorrencia);
  const statusGroup = text(properties.EstadoAgrupado);
  const natureCode = integer(properties.CodNatureza);
  const nature = text(properties.Natureza);
  const classification = text(properties.RASI);
  const startedAt = milliseconds(properties.DataOcorrencia);
  const latitude = coordinate(properties.Latitude, -90, 90);
  const longitude = coordinate(properties.Longitude, -180, 180);
  const groundPersonnel = nonNegativeInteger(properties.OperacionaisTerrestres);
  const airPersonnel = nonNegativeInteger(properties.OPAereos);
  const personnel = nonNegativeInteger(properties.Operacionais);
  const groundResources = nonNegativeInteger(properties.MeiosTerrestres);
  const airResources = nonNegativeInteger(properties.MeiosAereos);
  const entities = nonNegativeInteger(properties.QuantEntidades);
  if (
    !occurrenceNumber ||
    !status ||
    !statusGroup ||
    natureCode === undefined ||
    !nature ||
    !classification ||
    !startedAt ||
    latitude === undefined ||
    longitude === undefined ||
    groundPersonnel === undefined ||
    airPersonnel === undefined ||
    personnel === undefined ||
    groundResources === undefined ||
    airResources === undefined ||
    entities === undefined
  )
    return undefined;
  const payload: JsonObject = {
    occurrenceNumber,
    sourceId: nullableText(properties.ID),
    status,
    statusGroup,
    startedAt,
    natureCode: String(natureCode),
    nature: nature.replace(/^\d+\s*-\s*/u, ""),
    classification,
    firePhase: nullableDashText(properties.FaseIncendio),
    region: nullableText(properties.Regiao),
    subregion: nullableText(properties.SubRegiao),
    municipality: nullableText(properties.Concelho),
    parish: nullableText(properties.Freguesia),
    locality: nullableDashText(properties.Localidade),
    address: nullableDashText(properties.Endereco),
    groundPersonnel,
    airPersonnel,
    personnel,
    groundResources,
    airResources,
    entities,
    latitude,
    longitude,
    geometry: value.geometry,
  };
  return { entityKey: occurrenceNumber, eventTime: startedAt, payload };
}

function text(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" && value.length <= 500 ? value.trim() : undefined;
}

function nullableText(value: JsonValue | undefined): string | null {
  return text(value) ?? null;
}

function nullableDashText(value: JsonValue | undefined): string | null {
  const valueText = text(value);
  return valueText && !/^[-\s]+$/u.test(valueText) ? valueText : null;
}

function integer(value: JsonValue | undefined): number | undefined {
  return isJsonNumber(value) && Number.isSafeInteger(value) ? value : undefined;
}

function nonNegativeInteger(value: JsonValue | undefined): number | undefined {
  const parsed = integer(value);
  return parsed !== undefined && parsed >= 0 ? parsed : undefined;
}

function coordinate(value: JsonValue | undefined, minimum: number, maximum: number): number | undefined {
  return isJsonNumber(value) && Number.isFinite(value) && value >= minimum && value <= maximum ? value : undefined;
}

function milliseconds(value: JsonValue | undefined): string | undefined {
  if (!isJsonNumber(value) || !Number.isSafeInteger(value) || value <= 0) return undefined;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
