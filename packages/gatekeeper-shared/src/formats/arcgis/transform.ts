import {
  GatekeeperError,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  streamJsonArray,
  type CanonicalField,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type StreamingTransform,
  type TransformContext,
} from "../../index";

/** Largest single feature accepted, in bytes: a detailed boundary polygon fits. */
export const MAX_FEATURE_BYTES = 5 * 1024 * 1024;
/** The document's `arcgis` member is re-serialized layer metadata, itself read under 1 MiB. */
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const PRODUCT_KEY = "features";

interface CodedValue {
  name: string;
  code: string | number;
}

interface ArcgisField {
  name: string;
  alias: string;
  type: string;
  nullable: boolean;
  domain?: { type: "codedValue"; codedValues: CodedValue[] };
}

interface ArcgisMetadata {
  layerUrl: string;
  name: string;
  description: string;
  copyrightText: string;
  geometryType: string;
  objectIdField: string;
  globalIdField?: string;
  fields: ArcgisField[];
}

interface GeojsonFeature {
  properties: JsonObject;
  geometry: JsonObject | null;
}

interface PreparedField {
  source: ArcgisField;
  outputName: string;
  /** The type the declaration promises; string attributes are refined in `finish`. */
  type: CanonicalField["type"];
  codedLabels?: ReadonlyMap<string, string>;
  profile: FieldProfile;
}

/**
 * Bounded evidence about one attribute across every feature: how often it was
 * present, and whether every string was a URL, a colour, or one of at most
 * twenty values. It never holds more than 21 distinct strings.
 */
class FieldProfile {
  present = 0;
  private strings = 0;
  private urls = 0;
  private colors = 0;
  private readonly distinct = new Set<string>();

  constructor(private readonly inferString: boolean) {}

  observe(value: JsonValue | undefined): void {
    if (value === null || value === undefined) return;
    this.present += 1;
    if (!this.inferString || !isJsonString(value)) return;
    this.strings += 1;
    if (isHttpUrl(value)) this.urls += 1;
    if (/^#[0-9a-f]{6}$/i.test(value)) this.colors += 1;
    if (this.distinct.size <= 20) this.distinct.add(value);
  }

  stringType(): CanonicalField["type"] {
    if (this.strings > 0 && this.strings === this.present) {
      if (this.urls === this.strings) return "url";
      if (this.colors === this.strings) return "color";
      if (this.distinct.size <= 20) return "category";
    }
    return "string";
  }
}

export class ArcgisTransformer {
  readonly id = "arcgis-rest-layer";
  readonly version = "2";

  /**
   * Stream one layer document. Its `arcgis` metadata precedes `features`, so
   * the product is declared from metadata after the first feature is read;
   * string attribute types and nullability are refined over every feature and
   * reported through `finish`.
   */
  async transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
    const document = streamJsonArray(body, [PRODUCT_KEY], { maxElementBytes: MAX_FEATURE_BYTES, maxEnvelopeBytes: MAX_ENVELOPE_BYTES });
    const features = document.elements[Symbol.asyncIterator]();
    const first = await features.next();
    const envelope = document.envelope();
    if (envelope.type !== "FeatureCollection" || !isJsonObject(envelope.arcgis)) {
      invalid("ArcGIS artifact must be a metadata-bearing GeoJSON FeatureCollection");
    }
    if (!Array.isArray(envelope.features)) invalid("ArcGIS artifact has no features array");
    const metadata = parseMetadata(envelope.arcgis);
    const fields = prepareFields(metadata);
    const keyField = metadata.globalIdField ?? metadata.objectIdField;
    let total = 0;
    let accepted = 0;

    async function* rows(): AsyncGenerator<NormalizedRow> {
      let next = first;
      try {
        while (!next.done) {
          const feature = parseFeature(next.value);
          total += 1;
          for (const field of fields) field.profile.observe(feature.properties[field.source.name]);
          const record = featureRecord(feature, fields, keyField);
          if (record) {
            accepted += 1;
            yield { productKey: PRODUCT_KEY, record };
          }
          next = await features.next();
        }
      } finally {
        if (!next.done) await features.return?.(undefined);
      }
    }

    return {
      products: [
        {
          productKey: PRODUCT_KEY,
          slug: productSlug(context.feed.slug),
          title: context.feed.title,
          description: productDescription(metadata),
          role: "reference",
          kind: "record",
          schema: layerSchema(fields, undefined),
          updateMode: "authoritative-snapshot",
          completeness: "complete",
        },
      ],
      rows: rows(),
      finish: () => {
        const rejectedRecords = total - accepted;
        return {
          quality: { acceptedRecords: accepted, rejectedRecords },
          products: [{ productKey: PRODUCT_KEY, schema: layerSchema(fields, total) }],
        };
      },
    };
  }
}

function featureRecord(feature: GeojsonFeature, fields: PreparedField[], keyField: string): CanonicalRecord | undefined {
  const key = feature.properties[keyField];
  if ((!isJsonString(key) && !isJsonNumber(key)) || String(key) === "") return undefined;
  const payload: JsonObject = {};
  for (const field of fields) {
    const raw = feature.properties[field.source.name] ?? null;
    if (field.codedLabels) {
      payload[field.outputName] = raw === null ? null : (field.codedLabels.get(String(raw)) ?? String(raw));
      payload[`${field.outputName} code`] = raw;
    } else {
      payload[field.outputName] = canonicalValue(raw, field.type);
    }
  }
  payload.geometry = feature.geometry;
  const centroid = geometryCentroid(feature.geometry);
  payload.latitude = centroid?.[1] ?? null;
  payload.longitude = centroid?.[0] ?? null;
  return { entityKey: String(key), payload };
}

/**
 * The product schema. Declared up front (`total` undefined) it trusts the
 * metadata's nullability and types string attributes as plain strings; after
 * every feature it refines both and places the colour badge.
 */
function layerSchema(fields: PreparedField[], total: number | undefined): CanonicalSchema {
  const final = total !== undefined;
  const typed = fields.map((field) => {
    const type = final && field.type === "string" && field.source.type === "esriFieldTypeString" && !field.codedLabels ? field.profile.stringType() : field.type;
    const canonical: CanonicalField = {
      id: fieldId(field.source.name),
      name: field.outputName,
      type,
      nullable: field.source.nullable || (final && field.profile.present < total),
    };
    return { field, canonical };
  });
  if (final) applyColorBadge(typed);
  const schemaFields = typed.flatMap(({ field, canonical }) =>
    field.codedLabels
      ? [canonical, { id: `${field.source.name}__code`, name: `${field.outputName} code`, type: "identifier" as const, nullable: canonical.nullable }]
      : [canonical],
  );
  schemaFields.push(
    { id: "geometry", name: "geometry", type: "geometry", nullable: true },
    { id: "latitude", name: "latitude", type: "latitude", nullable: true },
    { id: "longitude", name: "longitude", type: "longitude", nullable: true },
  );
  return { fields: schemaFields };
}

function parseMetadata(value: JsonObject): ArcgisMetadata {
  if (!Array.isArray(value.fields) || value.fields.length === 0) {
    invalid("ArcGIS artifact metadata has no fields");
  }
  const globalIdField = optionalString(value.globalIdField);
  const metadata: ArcgisMetadata = {
    layerUrl: requiredString(value.layerUrl, "layer URL"),
    name: requiredString(value.name, "layer name"),
    description: isJsonString(value.description) ? value.description : "",
    copyrightText: isJsonString(value.copyrightText) ? value.copyrightText : "",
    geometryType: requiredString(value.geometryType, "geometry type"),
    objectIdField: requiredString(value.objectIdField, "object ID field"),
    fields: value.fields.map(parseField),
  };
  if (globalIdField) metadata.globalIdField = globalIdField;
  return metadata;
}

function parseField(value: JsonValue | undefined): ArcgisField {
  if (!isJsonObject(value)) invalid("ArcGIS field metadata is malformed");
  const field: ArcgisField = {
    name: requiredString(value.name, "field name"),
    alias: optionalString(value.alias) ?? requiredString(value.name, "field name"),
    type: requiredString(value.type, "field type"),
    nullable: value.nullable !== false,
  };
  const domain = parseDomain(value.domain);
  if (domain) field.domain = domain;
  return field;
}

function parseDomain(value: JsonValue | undefined): ArcgisField["domain"] | undefined {
  if (!isJsonObject(value) || value.type !== "codedValue" || !Array.isArray(value.codedValues)) {
    return undefined;
  }
  const codedValues = value.codedValues.flatMap((entry) => {
    if (!isJsonObject(entry) || !isJsonString(entry.name) || (!isJsonString(entry.code) && !isJsonNumber(entry.code))) {
      return [];
    }
    return [{ name: entry.name, code: entry.code }];
  });
  return { type: "codedValue", codedValues };
}

function parseFeature(value: JsonValue | undefined): GeojsonFeature {
  if (!isJsonObject(value) || value.type !== "Feature" || !isJsonObject(value.properties)) {
    invalid("ArcGIS artifact contains a malformed feature");
  }
  if (value.geometry !== null && !isJsonObject(value.geometry)) {
    invalid("ArcGIS artifact contains malformed geometry");
  }
  return { properties: value.properties, geometry: value.geometry };
}

function prepareFields(metadata: ArcgisMetadata): PreparedField[] {
  const outputNames = new Set<string>();
  return metadata.fields.map((source) => {
    const outputName = uniqueOutputName(source.alias, source.name, outputNames);
    outputNames.add(outputName);
    const codedLabels = source.domain ? new Map(source.domain.codedValues.map((item) => [String(item.code), item.name])) : undefined;
    const prepared: PreparedField = {
      source,
      outputName,
      type: codedLabels ? "category" : canonicalType(source.type),
      profile: new FieldProfile(!codedLabels && source.type === "esriFieldTypeString"),
    };
    if (codedLabels) prepared.codedLabels = codedLabels;
    return prepared;
  });
}

function canonicalType(arcgisType: string): CanonicalField["type"] {
  switch (arcgisType) {
    case "esriFieldTypeOID":
    case "esriFieldTypeGlobalID":
    case "esriFieldTypeGUID":
      return "identifier";
    case "esriFieldTypeDate":
      return "datetime";
    case "esriFieldTypeDouble":
    case "esriFieldTypeInteger":
    case "esriFieldTypeSingle":
    case "esriFieldTypeSmallInteger":
      return "number";
    case "esriFieldTypeString":
    case "esriFieldTypeXML":
      return "string";
    case "esriFieldTypeGeometry":
      return "geometry";
    case "esriFieldTypeBlob":
    case "esriFieldTypeRaster":
      return "json";
    default:
      return "json";
  }
}

function canonicalValue(value: JsonValue | undefined, type: CanonicalField["type"]): JsonValue {
  if (value === null || value === undefined) return null;
  if (type === "datetime") {
    const timestamp = isJsonNumber(value) ? value : Date.parse(String(value));
    const date = new Date(timestamp);
    return Number.isFinite(timestamp) && !Number.isNaN(date.getTime()) ? date.toISOString() : null;
  }
  return value;
}

/** A field with the canonical type it ends up with. */
interface TypedField {
  field: PreparedField;
  canonical: CanonicalField;
}

function applyColorBadge(fields: TypedField[]): void {
  const color = fields.find((entry) => entry.canonical.type === "color");
  if (!color) return;
  const textual = (entry: TypedField) => entry !== color && (entry.canonical.type === "string" || entry.canonical.type === "category");
  const label = fields.find((entry) => textual(entry) && entry.field.codedLabels === undefined) ?? fields.find(textual);
  if (label) {
    label.canonical.display = { badge: { colorField: color.field.outputName } };
  }
}

function geometryCentroid(geometry: JsonObject | null): [number, number] | undefined {
  if (!geometry || !isJsonString(geometry.type)) return undefined;
  if (geometry.type === "Point") {
    return position(geometry.coordinates);
  }
  const positions = collectPositions(geometry.coordinates);
  if (positions.length === 0) return undefined;
  if (geometry.type === "LineString" || geometry.type === "MultiLineString") {
    const segments = collectLineSegments(geometry.coordinates);
    let weightedX = 0;
    let weightedY = 0;
    let totalLength = 0;
    for (const [start, end] of segments) {
      const length = Math.hypot(end[0] - start[0], end[1] - start[1]);
      weightedX += ((start[0] + end[0]) / 2) * length;
      weightedY += ((start[1] + end[1]) / 2) * length;
      totalLength += length;
    }
    if (totalLength > 0) return [weightedX / totalLength, weightedY / totalLength];
  }
  if (geometry.type === "Polygon" || geometry.type === "MultiPolygon") {
    const areaCentroid = polygonCentroid(geometry.coordinates);
    if (areaCentroid) return areaCentroid;
  }
  let totalX = 0;
  let totalY = 0;
  for (const item of positions) {
    totalX += item[0];
    totalY += item[1];
  }
  return [totalX / positions.length, totalY / positions.length];
}

function collectPositions(value: JsonValue | undefined): Array<[number, number]> {
  const direct = position(value);
  if (direct) return [direct];
  if (!Array.isArray(value)) return [];
  return value.flatMap(collectPositions);
}

function collectLineSegments(value: JsonValue | undefined): Array<[[number, number], [number, number]]> {
  if (!Array.isArray(value)) return [];
  const points = value.map(position).filter((item) => item !== undefined);
  if (points.length === value.length && points.length >= 2) {
    const segments: Array<[[number, number], [number, number]]> = [];
    for (let index = 1; index < points.length; index += 1) {
      const start = points[index - 1];
      const end = points[index];
      if (start && end) segments.push([start, end]);
    }
    return segments;
  }
  return value.flatMap(collectLineSegments);
}

function polygonCentroid(value: JsonValue | undefined): [number, number] | undefined {
  const rings = collectRings(value);
  let crossTotal = 0;
  let weightedX = 0;
  let weightedY = 0;
  for (const ring of rings) {
    for (let index = 0; index < ring.length - 1; index += 1) {
      const start = ring[index];
      const end = ring[index + 1];
      if (!start || !end) continue;
      const cross = start[0] * end[1] - end[0] * start[1];
      crossTotal += cross;
      weightedX += (start[0] + end[0]) * cross;
      weightedY += (start[1] + end[1]) * cross;
    }
  }
  if (Math.abs(crossTotal) < Number.EPSILON) return undefined;
  return [weightedX / (3 * crossTotal), weightedY / (3 * crossTotal)];
}

function collectRings(value: JsonValue | undefined): Array<Array<[number, number]>> {
  if (!Array.isArray(value)) return [];
  const positions = value.map(position).filter((item) => item !== undefined);
  if (positions.length === value.length && positions.length >= 4) {
    return [positions];
  }
  return value.flatMap(collectRings);
}

function position(value: JsonValue | undefined): [number, number] | undefined {
  if (!Array.isArray(value) || !isJsonNumber(value[0]) || !isJsonNumber(value[1]) || !Number.isFinite(value[0]) || !Number.isFinite(value[1])) {
    return undefined;
  }
  return [value[0], value[1]];
}

function productSlug(feedSlug: string): string {
  const slug = feedSlug.replace(/-feed$/, "");
  return slug === "" ? "arcgis-layer" : slug;
}

function productDescription(metadata: ArcgisMetadata): string {
  const sourceDescription = plainText(metadata.description);
  const copyright = plainText(metadata.copyrightText);
  return [`ArcGIS layer “${metadata.name}”.`, sourceDescription, `Source copyright: ${copyright || "not stated"}.`].filter(Boolean).join(" ");
}

function plainText(value: string): string {
  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Fields every feature carries, derived from its geometry rather than read from an attribute. */
const GEOMETRY_FIELDS = ["geometry", "latitude", "longitude"];

/**
 * The schema ID of a source attribute. A layer may have its own `latitude`
 * or `longitude` attribute; it keeps its values under a distinct ID so it
 * cannot collide with the fields derived from the geometry.
 */
function fieldId(sourceName: string): string {
  return GEOMETRY_FIELDS.includes(sourceName) ? `${sourceName}__source` : sourceName;
}

function uniqueOutputName(alias: string, sourceName: string, existing: ReadonlySet<string>): string {
  if (!existing.has(alias) && !GEOMETRY_FIELDS.includes(alias)) {
    return alias;
  }
  if (!existing.has(sourceName) && !GEOMETRY_FIELDS.includes(sourceName)) {
    return sourceName;
  }
  let suffix = 2;
  while (existing.has(`${alias} (${suffix})`)) suffix += 1;
  return `${alias} (${suffix})`;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (!isJsonString(value) || value.trim() === "") {
    invalid(`ArcGIS artifact ${label} is missing`);
  }
  return value;
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" ? value : undefined;
}

function invalid(message: string): never {
  throw new GatekeeperError(message, "invalid-response");
}
