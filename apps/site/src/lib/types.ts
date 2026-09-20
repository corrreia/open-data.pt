// The API's contract as the site reads it. /openapi.json is the source of truth; these name what the pages use.

export type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
export type JsonRecord = { [key: string]: JsonValue };

export type Role = "reference" | "current-state" | "event-log" | "time-series" | "summary";

export interface FieldDisplay {
  badge?: { colorField: string; textColorField?: string };
}

export interface Field {
  id: string;
  name: string;
  type: string;
  nullable?: boolean;
  unit?: string;
  display?: FieldDisplay;
}

export interface Product {
  id: string;
  slug: string;
  title: string;
  description?: string;
  feedId: string;
  role: Role;
  schema: { fields: Field[] };
  rowCount: number;
  version: number;
  updatedAt: string;
  watermark?: string;
  status: string;
  stale?: boolean;
  staleAfterSeconds: number;
  cadenceSeconds: number;
  licence?: Term | null;
  attribution?: string;
  historyMode: string;
  exposeHistory: boolean;
  hasChanges: boolean;
  hasSeries: boolean;
  completeness?: string;
  currentAcquisitionId?: string;
}

/** One entry of a catalog vocabulary as the API serves it: a stable key, a name to show, and its page when it has one. */
export interface Term {
  id: string;
  name: string;
  url?: string;
  description?: string;
  /** A publisher's mark on this site; absent for one whose initials stand in for it, and never set for a licence. */
  logo?: string;
}

export interface Feed {
  id: string;
  slug: string;
  title: string;
  description: string;
  publisher: Term;
  topics?: string[];
  /** The standard the publisher shares it through (arcgis, ckan, opendatasoft, gtfs, gbfs, udata), or own-api. */
  format: string;
  /** How often it is collected; null for a feed whose policy is gone. */
  cadenceSeconds: number | null;
  enabled: boolean;
  staleAfterSeconds: number;
  sourceUrl?: string;
  /** Feed creation time; collection history cannot be known before it existed. */
  createdAt?: string;
  lastSuccessAt?: string;
  lastAttemptAt?: string;
  nextRunAt?: string;
  running?: boolean;
  consecutiveFailures?: number;
  lastAcquisitionStatus?: AcquisitionStatus;
}

export type AcquisitionStatus = "failed" | "queued" | "running" | "succeeded" | "unchanged";

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
  completeness?: string;
  normalizer?: { id: string; version: string };
  quality?: { acceptedRecords: number; rejectedRecords: number };
  rows?: number;
  revisions?: number;
  error?: string;
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

export interface SeriesPoint {
  seriesKey: string;
  eventTime: string;
  value: number | null;
  unit?: string;
  dimensions?: { [dimension: string]: string | number | null };
  observedAt?: string;
  ingestedAt?: string;
}

export type SummaryResolution = "hour" | "day" | "month";

/** One hour, Lisbon day or Lisbon month of a series: how many points, and their mean, lowest and highest value. */
export interface SummaryBucket {
  start: string;
  count: number;
  mean: number;
  min: number;
  max: number;
}

/** GET /series/summary: each series' buckets per hour, Lisbon day or Lisbon month. */
export interface SeriesSummary {
  resolution: SummaryResolution;
  timeZone: string;
  from: string;
  to: string;
  /** The oldest and newest Lisbon days summarised, and the instant the newest ends: later points are only in the live window. */
  coverage: { firstDay: string | null; through: string | null; until: string | null };
  series: Array<{
    seriesKey: string;
    unit: string;
    dimensions: JsonValue;
    buckets: SummaryBucket[];
  }>;
}

export interface Change {
  revisionId?: string;
  entityKey: string;
  operation: string;
  eventTime?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  sourcePublishedAt?: string | null;
  observedAt?: string;
  ingestedAt?: string;
  payload?: JsonRecord;
}

export interface Page<T> {
  data: T[];
  nextCursor?: string | null;
  coverage?: { complete?: boolean };
}

export interface Geometry {
  type: string;
  coordinates?: JsonValue;
  geometries?: Geometry[];
}

export interface Feature {
  type: "Feature";
  id?: string | number;
  geometry: Geometry;
  properties: JsonRecord;
}

export interface FeatureCollection {
  type: "FeatureCollection";
  features: Feature[];
}

/** Every run of one UTC day, and whether the mirror still reaches back to its start. */
export interface AcquisitionDay {
  day: string;
  complete: boolean;
  data: Acquisition[];
}

/** GET /api/analytics: request counts from Analytics Engine over one window. */
export interface AnalyticsReport {
  days: number;
  resolution: "hour" | "day";
  from: string;
  to: string;
  retentionDays: number;
  timeline: Array<{ time: string; surface: string; kind: string; requests: number }>;
  clients: Array<{ surface: string; kind: string; name: string; requests: number }>;
  routes: Array<{ surface: string; route: string; requests: number; meanMs: number }>;
  subjects: Array<{ surface: string; route: string; subject: string; requests: number }>;
  countries: Array<{ surface: string; country: string; requests: number }>;
  referrers: Array<{ surface: string; referrer: string; requests: number }>;
  outcomes: Array<{ surface: string; status: string; cache: string; format: string; requests: number }>;
  mcp: Array<{ call: string; client: string; requests: number }>;
}
