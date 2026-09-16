import {
  GatekeeperError,
  isJsonArray,
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
  type ProductFinalization,
  type StreamingTransform,
  type TransformContext,
} from "../../index";
import { representativePoint } from "./geometry";

import type { OgcCollectionDescription, OgcProperty } from "./ogc";

/**
 * Largest single feature read from a page, in bytes. One measured DGT district
 * outline is 3.6 MB of coordinates, so this is what the reader must hold to see
 * a feature at all; only one is held at a time.
 */
export const MAX_FEATURE_BYTES = 8 * 1024 * 1024;
/**
 * Largest single record published, in bytes: the kernel's own per-record
 * ceiling, since a record is stored whole in SQLite. A feature past it is
 * rejected as one row rather than failing the collection, which leaves the
 * product partial and therefore unable to retract what it did not carry.
 */
export const MAX_RECORD_BYTES = 1024 * 1024;

/** The document's `ogc` member is the collection description and its published property schema. */
const MAX_ENVELOPE_BYTES = 2 * 1024 * 1024;
const PRODUCT_KEY = "features";
/** Distinct string values kept per property while deciding whether it is a category. */
const MAX_DISTINCT = 20;
/** Properties the normalizer will describe, whether declared or discovered. */
const MAX_PROPERTIES = 512;
/** Fields every feature carries because they come from its geometry, not from a property. */
const GEOMETRY_FIELDS = ["geometry", "latitude", "longitude"];

interface GeojsonFeature {
  id: JsonValue | undefined;
  properties: JsonObject;
  geometry: JsonObject | null;
}

/**
 * Bounded evidence about one property across every feature: how often it was
 * present, what JSON shapes it held, and whether every string was a URL or one
 * of at most twenty values. It never holds more than 21 distinct strings.
 */
class PropertyProfile {
  present = 0;
  private strings = 0;
  private numbers = 0;
  private booleans = 0;
  private timestamps = 0;
  private dates = 0;
  private urls = 0;
  private readonly distinct = new Set<string>();

  observe(value: JsonValue | undefined): void {
    if (value === null || value === undefined) return;
    this.present += 1;
    if (isJsonNumber(value)) {
      this.numbers += 1;
      return;
    }
    if (value === true || value === false) {
      this.booleans += 1;
      return;
    }
    if (!isJsonString(value)) return;
    this.strings += 1;
    if (isHttpUrl(value)) this.urls += 1;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) this.dates += 1;
    else if (isTimestamp(value)) this.timestamps += 1;
    if (this.distinct.size <= MAX_DISTINCT) this.distinct.add(value);
  }

  /** The type the evidence supports, for a property the service did not type. */
  inferredType(): CanonicalField["type"] {
    if (this.present === 0) return "string";
    if (this.numbers === this.present) return "number";
    if (this.booleans === this.present) return "boolean";
    if (this.strings !== this.present) return "json";
    if (this.urls === this.strings) return "url";
    if (this.dates === this.strings) return "date";
    if (this.timestamps === this.strings) return "datetime";
    if (this.distinct.size <= MAX_DISTINCT) return "category";
    return "string";
  }

  /** A declared string property is narrowed only where the evidence is unambiguous. */
  refinedString(): CanonicalField["type"] {
    if (this.strings === 0 || this.strings !== this.present) return "string";
    if (this.urls === this.strings) return "url";
    if (this.distinct.size <= MAX_DISTINCT) return "category";
    return "string";
  }
}

interface PreparedProperty {
  name: string;
  outputName: string;
  /** The type declared up front, from the service's published schema. */
  declared: CanonicalField["type"];
  /** Whether the service published a type at all; discovered properties are inferred instead. */
  published: boolean;
  profile: PropertyProfile;
}

export class OgcTransformer {
  readonly id = "ogc-api-features";
  readonly version = "1";

  /**
   * Stream one collection document. Its `ogc` description precedes `features`,
   * so the product is declared from that description after the first feature is
   * read; property types and nullability are refined over every feature and
   * reported through `finish`.
   */
  async transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
    const document = streamJsonArray(body, [PRODUCT_KEY], { maxElementBytes: MAX_FEATURE_BYTES, maxEnvelopeBytes: MAX_ENVELOPE_BYTES });
    const items = document.elements[Symbol.asyncIterator]();
    const first = await items.next();
    const envelope = document.envelope();
    if (envelope.type !== "FeatureCollection" || !isJsonObject(envelope.ogc)) {
      invalid("OGC artifact must be a description-bearing GeoJSON FeatureCollection");
    }
    if (!isJsonArray(envelope.features)) invalid("OGC artifact has no features array");
    const description = parseDescription(envelope.ogc);
    const properties = prepareProperties(description);
    const byName = new Map(properties.map((property) => [property.name, property]));
    const withGeometry = description.geometry === "include";
    let total = 0;
    let accepted = 0;
    const identities = new Set<string>();
    let identityBudget = 0;

    async function* rows(): AsyncGenerator<NormalizedRow> {
      let next = first;
      try {
        while (!next.done) {
          const feature = parseFeature(next.value);
          total += 1;
          for (const [name, value] of Object.entries(feature.properties)) {
            const known = byName.get(name);
            if (known) known.profile.observe(value);
            else if (properties.length < MAX_PROPERTIES) {
              const discovered = discoveredProperty(name, properties);
              byName.set(name, discovered);
              properties.push(discovered);
              discovered.profile.observe(value);
            }
          }
          const record = featureRecord(feature, properties, withGeometry);
          if (record) {
            // Validate the final identity too: the source may omit Feature.id and
            // use an identifying schema property, or mix the two representations.
            if (identities.has(record.entityKey)) invalid("OGC collection repeats a normalized feature identity");
            identityBudget += record.entityKey.length * 2 + 128;
            if (identityBudget > 8 * 1024 * 1024) {
              throw new GatekeeperError("OGC identity validation exceeds its memory budget", "response-too-large");
            }
            identities.add(record.entityKey);
            accepted += 1;
            yield { productKey: PRODUCT_KEY, record };
          }
          next = await items.next();
        }
      } finally {
        if (!next.done) await items.return?.(undefined);
      }
    }

    return {
      products: [
        {
          productKey: PRODUCT_KEY,
          slug: productSlug(context.feed.slug),
          title: context.feed.title,
          description: productDescription(description),
          role: "reference",
          kind: "record",
          schema: collectionSchema(properties, withGeometry, undefined),
          updateMode: "authoritative-snapshot",
          completeness: "complete",
        },
      ],
      rows: rows(),
      finish: () => {
        // A collection whose count the service stated must deliver it; short of
        // that the batch is not the whole membership and may not retract.
        const short = description.expected !== undefined && accepted < description.expected;
        const final: ProductFinalization = { productKey: PRODUCT_KEY, schema: collectionSchema(properties, withGeometry, total) };
        if (short) final.completeness = "partial";
        return { quality: { acceptedRecords: accepted, rejectedRecords: total - accepted }, products: [final] };
      },
    };
  }
}

/**
 * One feature as a record. Its payload holds every property the collection has,
 * present or not, plus the geometry and its representative point when geometry
 * was requested. A feature without a usable identity, or one too large to
 * store, is left out and counted as rejected.
 */
function featureRecord(feature: GeojsonFeature, properties: PreparedProperty[], withGeometry: boolean): CanonicalRecord | undefined {
  const key = entityKey(feature, properties);
  if (key === undefined) return undefined;
  const payload: JsonObject = {};
  for (const property of properties) {
    payload[property.outputName] = feature.properties[property.name] ?? null;
  }
  if (withGeometry) {
    payload.geometry = feature.geometry;
    const point = representativePoint(feature.geometry);
    payload.latitude = point?.[1] ?? null;
    payload.longitude = point?.[0] ?? null;
  }
  const record: CanonicalRecord = { entityKey: key, payload };
  const encoded = JSON.stringify(record);
  // UTF-16 length is a lower bound on UTF-8 bytes and `length * 3` an upper one,
  // so only a record between the two needs the exact count. Checking
  // `length > limit` alone would let a multi-byte record under the limit in
  // characters through while being over it in bytes, which the kernel would
  // then refuse mid-stream instead of this rejecting it cleanly.
  if (encoded.length * 3 > MAX_RECORD_BYTES && utf8Length(encoded) > MAX_RECORD_BYTES) return undefined;
  return record;
}

/**
 * The feature's own identifier: OGC API Features gives every feature a stable
 * `id`, and a service that omits it may still mark an identifying property
 * through the `id` role of its published schema.
 */
function entityKey(feature: GeojsonFeature, properties: PreparedProperty[]): string | undefined {
  const id = feature.id;
  if (isJsonString(id) && id.trim() !== "") return id;
  if (isJsonNumber(id) && Number.isFinite(id)) return String(id);
  const identifying = properties.find((property) => property.published && property.declared === "identifier");
  if (!identifying) return undefined;
  const value = feature.properties[identifying.name];
  if (isJsonString(value) && value.trim() !== "") return value;
  if (isJsonNumber(value) && Number.isFinite(value)) return String(value);
  return undefined;
}

/**
 * The product schema. Declared up front (`total` undefined) it trusts the
 * service's published types; after every feature it narrows the properties the
 * service left untyped and marks as nullable each one some feature omitted.
 */
function collectionSchema(properties: PreparedProperty[], withGeometry: boolean, total: number | undefined): CanonicalSchema {
  const final = total !== undefined;
  const fields = properties.map((property): CanonicalField => ({
    id: fieldId(property.name),
    name: property.outputName,
    type: !final
      ? property.declared
      : property.published
        ? (property.declared === "string" ? property.profile.refinedString() : property.declared)
        : property.profile.inferredType(),
    nullable: !final || property.profile.present < total,
  }));
  if (withGeometry) {
    fields.push(
      { id: "geometry", name: "geometry", type: "geometry", nullable: true },
      { id: "latitude", name: "latitude", type: "latitude", nullable: true },
      { id: "longitude", name: "longitude", type: "longitude", nullable: true },
    );
  }
  return { fields };
}

function parseDescription(value: JsonObject): OgcCollectionDescription {
  const description: OgcCollectionDescription = {
    itemsUrl: requiredString(value.itemsUrl, "items URL"),
    collectionUrl: requiredString(value.collectionUrl, "collection URL"),
    collectionId: requiredString(value.collectionId, "collection id"),
    title: isJsonString(value.title) ? value.title : requiredString(value.collectionId, "collection id"),
    description: isJsonString(value.description) ? value.description : "",
    keywords: isJsonArray(value.keywords) ? value.keywords.filter(isJsonString) : [],
    geometry: value.geometry === "skip" ? "skip" : "include",
  };
  if (isJsonArray(value.properties)) description.properties = value.properties.filter(isJsonString);
  if (isJsonNumber(value.expected) && Number.isSafeInteger(value.expected) && value.expected >= 0) {
    description.expected = value.expected;
  }
  if (isJsonArray(value.schema)) {
    const schema = value.schema.flatMap((entry) => (isJsonObject(entry) && isJsonString(entry.name)
      ? [parseProperty(entry, entry.name)]
      : []));
    if (schema.length > 0) description.schema = schema.slice(0, MAX_PROPERTIES);
  }
  return description;
}

function parseProperty(value: JsonObject, name: string): OgcProperty {
  const property: OgcProperty = { name, type: isJsonString(value.type) ? value.type : "unknown" };
  if (isJsonString(value.format)) property.format = value.format;
  if (isJsonString(value.role)) property.role = value.role;
  return property;
}

function parseFeature(value: JsonValue | undefined): GeojsonFeature {
  if (!isJsonObject(value) || value.type !== "Feature" || !isJsonObject(value.properties)) {
    invalid("OGC artifact contains a malformed feature");
  }
  if (value.geometry !== null && value.geometry !== undefined && !isJsonObject(value.geometry)) {
    invalid("OGC artifact contains malformed geometry");
  }
  return { id: value.id, properties: value.properties, geometry: isJsonObject(value.geometry) ? value.geometry : null };
}

function prepareProperties(description: OgcCollectionDescription): PreparedProperty[] {
  const taken = new Set<string>();
  return (description.schema ?? []).map((property) => {
    const outputName = uniqueOutputName(property.name, taken);
    taken.add(outputName);
    return {
      name: property.name,
      outputName,
      declared: declaredType(property),
      published: property.type !== "unknown" || property.role === "id",
      profile: new PropertyProfile(),
    };
  });
}

/** A property no published schema mentioned; its type comes from the values themselves. */
function discoveredProperty(name: string, existing: PreparedProperty[]): PreparedProperty {
  const taken = new Set(existing.map((property) => property.outputName));
  const outputName = uniqueOutputName(name, taken);
  return { name, outputName, declared: "string", published: false, profile: new PropertyProfile() };
}

function declaredType(property: OgcProperty): CanonicalField["type"] {
  if (property.role === "id") return "identifier";
  if (property.format === "date") return "date";
  if (property.format === "date-time") return "datetime";
  switch (property.type) {
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "string":
      return "string";
    case "array":
    case "object":
      return "json";
    default:
      return "string";
  }
}

function productSlug(feedSlug: string): string {
  const slug = feedSlug.replace(/-feed$/, "");
  return slug === "" ? "ogc-collection" : slug;
}

function productDescription(description: OgcCollectionDescription): string {
  const parts = [
    `OGC API Features collection “${description.title}”.`,
    plainText(description.description),
    description.geometry === "skip"
      ? "Feature attributes only: this feed asks the service for its records without geometry."
      : "",
    description.properties ? `Only these properties were requested: ${description.properties.join(", ")}.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

function plainText(value: string): string {
  return value.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * The schema ID of a source property. A collection may have its own `latitude`
 * or `longitude` property; it keeps its values under a distinct ID so it cannot
 * collide with the fields derived from the geometry.
 */
function fieldId(name: string): string {
  return GEOMETRY_FIELDS.includes(name) ? `${name}__source` : name;
}

function uniqueOutputName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name) && !GEOMETRY_FIELDS.includes(name)) return name;
  let suffix = 2;
  while (taken.has(`${name} (${suffix})`)) suffix += 1;
  return `${name} (${suffix})`;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function isTimestamp(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}/.test(value) && !Number.isNaN(Date.parse(value));
}

/** UTF-8 length of a string, without encoding it. */
function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

function requiredString(value: JsonValue | undefined, label: string): string {
  if (!isJsonString(value) || value.trim() === "") invalid(`OGC artifact ${label} is missing`);
  return value;
}

function invalid(message: string): never {
  throw new GatekeeperError(message, "invalid-response");
}
