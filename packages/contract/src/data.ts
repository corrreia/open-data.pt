/*
 * The data model both Workers and the site describe rows with: what a product
 * is, what its fields are, and what one record or point looks like. It names
 * no Worker type, so a browser bundle can carry it.
 */
import type { JsonObject } from "./json";

export type { JsonObject, JsonValue } from "./json";

/** Whether a body, a product or a page is the whole of what the source holds for a feed. */
export type Completeness = "complete" | "partial" | "unknown";

/* ---------- Products and transforms (what a Gatekeeper returns after translating bytes) ---------- */

export type ProductRole = "current-state" | "event-log" | "reference" | "summary" | "time-series";

/**
 * Field types drive how the pages render a value. They describe the data, not
 * the source: a `color` gets a swatch, a `latitude`/`longitude` pair gets a map,
 * a `category` gets facets, `datetime` gets formatted, `json` gets truncated.
 */
export type FieldType = "boolean" | "category" | "color" | "date" | "datetime" | "geometry" | "identifier" | "json" | "latitude" | "longitude" | "number" | "string" | "url";

export interface FieldDisplay {
  /** Render the value as a badge coloured by another field of the same record. */
  badge?: { colorField: string; textColorField?: string };
  /** Present a human label instead of the raw field name. */
  label?: string;
}

export interface CanonicalField {
  id: string;
  name: string;
  type: FieldType;
  nullable: boolean;
  unit?: string;
  display?: FieldDisplay;
}

export interface CanonicalSchema {
  fields: CanonicalField[];
}

export type RecordOperation = "correct" | "create" | "delete" | "retract" | "upsert";

export interface CanonicalRecord {
  entityKey: string;
  operation?: RecordOperation;
  payload: JsonObject;
  eventTime?: string;
  validFrom?: string;
  validTo?: string;
  sourcePublishedAt?: string;
  sourceSequence?: string;
}

export interface SeriesPoint {
  seriesKey: string;
  eventTime: string;
  value: number;
  unit: string;
  dimensions: Record<string, string>;
}

export type ProductUpdateMode = "authoritative-snapshot" | "partial-snapshot" | "delta" | "source-window";

/** Everything the kernel must know about one product before its first row arrives. */
export interface ProductDeclaration {
  /** Stable local identity within one feed; presentation changes never change it. */
  productKey: string;
  /** Suggested initial public slug; the kernel owns the durable mapping. */
  slug: string;
  title: string;
  description: string;
  role: ProductRole;
  kind: "record" | "series";
  schema: CanonicalSchema;
  updateMode: ProductUpdateMode;
  completeness: Completeness;
  watermark?: string;
}

interface ProductBuildBase {
  productKey: string;
  slug: string;
  title: string;
  description: string;
  role: ProductRole;
  schema: CanonicalSchema;
  updateMode: ProductUpdateMode;
  completeness: Completeness;
  watermark?: string;
}

/** A buffered normalizer's record product: declaration plus every row. */
export interface RecordProductBuild extends ProductBuildBase {
  kind: "record";
  records: CanonicalRecord[];
  points?: never;
}

/** A buffered normalizer's series product: declaration plus every point. */
export interface SeriesProductBuild extends ProductBuildBase {
  kind: "series";
  points: SeriesPoint[];
  records?: never;
}

export type ProductBuild = RecordProductBuild | SeriesProductBuild;

/** How many rows a normalizer kept and how many it could not use. */
export interface TransformQuality {
  acceptedRecords: number;
  rejectedRecords: number;
}

/** A buffered normalizer's whole output, held in the Gatekeeper's memory. */
export interface TransformResult {
  /** Which translator produced this, for run logs and schema versions. */
  transformer: { id: string; version: string };
  products: ProductBuild[];
  quality: TransformQuality;
}

/** One normalized row on its way to the kernel. */
export type NormalizedRow = { productKey: string; record: CanonicalRecord; point?: never } | { productKey: string; point: SeriesPoint; record?: never };

/** Values only known once every row was seen, such as an inferred schema or the newest event time. */
export interface ProductFinalization {
  productKey: string;
  schema?: CanonicalSchema;
  watermark?: string;
  /**
   * A downgrade discovered while streaming, for example a declared file that
   * turned out to be absent. Never an upgrade: the kernel takes the weaker of
   * this and the header's completeness, and only `complete` may retract.
   */
  completeness?: Completeness;
}

export interface StreamingSummary {
  quality: TransformQuality;
  products?: ProductFinalization[];
}

/** A streaming normalizer's output: products declared up front, rows pulled one at a time. */
export interface StreamingTransform {
  products: ProductDeclaration[];
  rows: AsyncIterable<NormalizedRow>;
  /** Called once, after `rows` is exhausted. */
  finish(): StreamingSummary;
}
