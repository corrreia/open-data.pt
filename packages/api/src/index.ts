/*
 * The public API's wire shapes: what `/api/…` actually sends, named once. The
 * kernel builds its responses against these types and the site reads them, so
 * a field the kernel adds, renames or stops sending is a type error on both
 * sides rather than a page that quietly renders nothing. `openapi.json`
 * describes the same surface for everyone else.
 *
 * These are not the kernel's internal types: what a product or a feed is in
 * storage carries chunk lists, checkpoints and policy identifiers that the API
 * never serves. Nothing here is a Gatekeeper concern — that is the contract.
 */
import type { CanonicalSchema, Completeness, JsonObject, JsonValue, ProductRole, TransformQuality } from "@open-data-pt/contract/data";

export type { CanonicalField as Field, CanonicalSchema, FieldDisplay, FieldType, JsonObject, JsonValue, ProductRole as Role } from "@open-data-pt/contract/data";

/** One entry of a catalog vocabulary as the API serves it: a stable key, a name to show, and its page when it has one. */
export interface Term {
  id: string;
  name: string;
  url?: string;
  /** What a licence means; publishers need no description beyond their name. */
  description?: string;
  /** A publisher's mark on this site; absent for one whose initials stand in for it, and never set for a licence. */
  logo?: string;
}

/** A product as `/api/products` and `/api/products/{slug}` serve it. */
export interface Product {
  id: string;
  slug: string;
  feedId: string;
  title: string;
  description: string;
  role: ProductRole;
  schema: CanonicalSchema;
  version: number;
  status: "current" | "failed";
  /** The acquisition whose rows are served, or null before the first one finished. */
  currentAcquisitionId: string | null;
  /** The newest event time the product holds, or null for a product with no clock of its own. */
  watermark: string | null;
  rowCount: number;
  completeness: Completeness;
  stale: boolean;
  staleAfterSeconds: number;
  cadenceSeconds: number;
  historyMode: "changes" | "latest";
  exposeHistory: boolean;
  licence: Term | null;
  attribution: string | null;
  hasChanges: boolean;
  hasSeries: boolean;
  updatedAt: string;
}

export type AcquisitionStatus = "failed" | "queued" | "running" | "succeeded" | "unchanged";

/** A dataset as `/api/datasets` serves it: what the data is, whose it is, and under what terms. */
export interface Dataset {
  id: string;
  title: string;
  description?: string;
  publisher: Term;
  licence: Term;
  /** How the publisher asks to be credited, when they say. */
  attribution?: string;
  topics: string[];
}

/** A feed as `/api/feeds` serves it: which part of a dataset it reads, how often, and how its collection is going. */
export interface Feed {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** The dataset this feed reads part of: who published it and under what terms are its word. */
  dataset: Dataset;
  /** The standard the publisher shares it through (arcgis, ckan, opendatasoft, gtfs, gbfs, udata), or own-api. */
  format: string;
  /** How often it is collected; null for a feed whose policy is gone. */
  cadenceSeconds: number | null;
  enabled: boolean;
  staleAfterSeconds: number;
  createdAt: string;
  updatedAt: string;
  /** Where the latest live collection read its data: a page a person can open. */
  sourceUrl?: string;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  nextRunAt?: string;
  running?: boolean;
  consecutiveFailures?: number;
  lastAcquisitionStatus?: AcquisitionStatus;
}

/** One collection attempt as `/api/acquisitions` serves it; the policy version and the lake bookkeeping stay inside the platform. */
export interface Acquisition {
  id: string;
  feedId: string;
  trigger: string;
  status: AcquisitionStatus;
  requestedAt: string;
  startedAt?: string;
  completedAt?: string;
  observedAt?: string;
  eventTime?: string;
  sourcePublishedAt?: string;
  completeness?: Completeness;
  normalizer?: { id: string; version: string };
  quality?: TransformQuality;
  rows?: number;
  revisions?: number;
  error?: string;
}

/** Every run of one UTC day, and whether the mirror still reaches back to its start. */
export interface AcquisitionDay {
  day: string;
  complete: boolean;
  data: Acquisition[];
}

export type OutageCause = "source" | "collection" | "platform";

export interface Outage {
  feedId: string | null;
  startedAt: string;
  endedAt?: string;
  cause: OutageCause;
  failures: number;
  lastError?: string;
}

export interface OutagesResponse {
  from: string;
  to: string;
  trackedSince: string | null;
  data: Outage[];
}

/* ---------- History: the rolling window the kernel serves, and the lake behind it ---------- */

/** One record revision in the rolling window (`/changes`). */
export interface Change {
  id: string;
  entityKey: string;
  operation: string;
  payload: JsonObject | null;
  recordHash: string;
  eventTime: string | null;
  validFrom: string | null;
  validTo: string | null;
  sourcePublishedAt: string | null;
  sourceSequence: string | null;
  observedAt: string;
  ingestedAt: string;
  acquisitionId: string;
}

/** One record revision out of the lake (`/changes/range`): the same revision, identified as the lake stores it. */
export interface LakeChange {
  revisionId: string;
  entityKey: string;
  operation: string;
  eventTime: string | null;
  validFrom: string | null;
  validTo: string | null;
  sourcePublishedAt: string | null;
  sourceSequence: string | null;
  observedAt: string;
  ingestedAt: string;
  payload: JsonObject | null;
}

/** One point in the rolling window (`/series`). */
export interface SeriesPoint {
  seriesKey: string;
  eventTime: string;
  value: number;
  unit: string;
  dimensions: Record<string, string>;
  observedAt: string;
}

/** A point's correction in the rolling window (`/series/changes`): the point, plus what it replaced. */
export interface SeriesChange extends SeriesPoint {
  id: string;
  ingestedAt: string;
  acquisitionId: string;
  previousValue: number | null;
}

/** One point out of the lake (`/series/range`), whose dimensions are whatever the source published. */
export interface LakeSeriesPoint {
  seriesKey: string;
  eventTime: string;
  value: number;
  unit: string;
  dimensions: JsonObject;
  observedAt: string;
}

/** A point's correction out of the lake (`/series/changes/range`). */
export interface LakeSeriesChange extends LakeSeriesPoint {
  revisionId: string;
  ingestedAt: string;
}

/* ---------- Envelopes ---------- */

/** A whole list: the catalog endpoints, which have nothing to page through. */
export interface List<T> {
  data: T[];
}

/** A page of rows from the rolling window; `nextCursor` is absent once there is no more. */
export interface CursorPage<T> {
  data: T[];
  nextCursor?: string;
}

/** How current the product behind a history page is. */
export interface Freshness {
  updatedAt: string;
  stale: boolean;
}

/** What the lake holds for the window asked for, and why it may hold less. */
export interface Coverage {
  requested: { from: string; to: string };
  lakeStartsAt: string | null;
  coveredFrom: string | null;
  complete: boolean;
  reason: string | null;
}

/** A page out of the lake: rows, where to continue, and how far back the lake actually reaches. */
export interface HistoryPage<T> {
  data: T[];
  nextCursor: string | null;
  /** Records only: the knowledge time the rows were read as of. */
  knownAt?: string | null;
  freshness: Freshness;
  coverage: Coverage;
  source: "lake";
}

/* ---------- Series summaries ---------- */

export type SummaryResolution = "hour" | "day" | "month";

/** One hour, Lisbon day or Lisbon month of a series: how many points, and their mean, lowest and highest value. */
export interface SummaryBucket {
  start: string;
  count: number;
  mean: number;
  min: number;
  max: number;
}

export interface SummarySeries {
  seriesKey: string;
  unit: string;
  dimensions: JsonValue;
  buckets: SummaryBucket[];
}

/** The oldest and newest Lisbon days summarised, and the instant the newest ends: later points are only in the live window. */
export interface SummaryCoverage {
  firstDay: string | null;
  through: string | null;
  until: string | null;
}

/** `/series/summary`: each series' buckets per hour, Lisbon day or Lisbon month. */
export interface SeriesSummary {
  resolution: SummaryResolution;
  timeZone: string;
  from: string;
  to: string;
  coverage: SummaryCoverage;
  series: SummarySeries[];
}

/* ---------- GeoJSON ---------- */

export interface Geometry {
  type: string;
  coordinates?: JsonValue;
  geometries?: Geometry[];
}

export interface Feature {
  type: "Feature";
  id?: string;
  geometry: Geometry;
  properties: JsonObject;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  /** How many rows matched, when no filter narrowed them. */
  numberMatched?: number;
  numberReturned: number;
  timeStamp: string;
  features: Feature[];
}

/* ---------- Analytics ---------- */

/** `/api/analytics`: request counts from Analytics Engine over one window. */
export interface AnalyticsReport {
  days: number;
  resolution: "hour" | "day";
  from: string;
  to: string;
  retentionDays: number;
  /** Requests per hour or day, by surface and client kind. */
  timeline: Array<{ time: string; surface: string; kind: string; requests: number }>;
  clients: Array<{ surface: string; kind: string; name: string; requests: number }>;
  routes: Array<{ surface: string; route: string; requests: number; meanMs: number }>;
  subjects: Array<{ surface: string; route: string; subject: string; requests: number }>;
  countries: Array<{ surface: string; country: string; requests: number }>;
  referrers: Array<{ surface: string; referrer: string; medium: string; requests: number }>;
  outcomes: Array<{ surface: string; status: string; cache: string; format: string; requests: number }>;
  mcp: Array<{ call: string; client: string; requests: number }>;
}
