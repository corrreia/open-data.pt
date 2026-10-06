import { isJsonObject } from "@open-data-pt/contract";
import type {
  CanonicalSchema,
  CollectionFailureCode,
  CollectionPolicyDefinition,
  Completeness,
  HistoryCapability,
  JsonObject,
  JsonValue,
  ProductRole,
  ProductUpdateMode,
  SourceCheckpoint,
  TransformQuality,
} from "@open-data-pt/contract";

import type { ManifestChunk } from "#/serving/chunks";
import { locatorFor, type Box } from "#/serving/spatial";

/** Runtime state a FeedRunner reports to the Registry after every run. */
export interface BackfillSummary {
  status: "running" | "paused" | "complete" | "failed";
  cursor: string;
  until?: string;
  slices: number;
  points: number;
  records: number;
  failures: number;
  floors: Record<string, string>;
  startedAt: string;
  updatedAt: string;
  lastError?: string;
}

export interface FeedStatus {
  /**
   * Until when the feed waits after a permanent failure or repeated executor
   * kills; it then retries the same acquisition by itself. `lastError` says why.
   */
  cooldownUntil?: string;
  checkpoint?: SourceCheckpoint;
  backfill?: BackfillSummary;
  nextRunAt?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  lastAcquisitionStatus?: AcquisitionStatus;
  lastError?: string;
  consecutiveFailures?: number;
  running?: boolean;
  /** Committed history rows not yet delivered to the lake, in characters. */
  historyBacklog?: number;
  /** Where the latest live collection read its data: a page a person can open. */
  sourceUrl?: string;
}

export interface Feed extends FeedStatus {
  id: string;
  slug: string;
  title: string;
  description: string;
  /** The library that reads the feed. */
  library: string;
  /** What the feed reads, as the Gatekeeper resolved it: its checkpoint and the history of what it read hang on it. */
  resourceKey: string;
  /** Digest of the feed's whole canonical configuration; the Gatekeeper collects only the configuration it names. */
  configHash: string;
  /** Its facts are events or observations: a history window need not scan what was ingested long before it. */
  eventTimed: boolean;
  /** Present when the source hands out history older than a live collection returns. */
  history?: HistoryCapability;
  /** How it is collected: how often, for how long, how much it may read, and whether its changes are history. */
  policy: CollectionPolicyDefinition;
  /** Semantic collection generation, independent of administrative edits. */
  feedEpoch: string;
  enabled: boolean;
  staleAfterSeconds: number;
  /** Who made the data: a key of the publishers the Gatekeeper's catalog declares. */
  publisher: string;
  /** The terms it is served under: a key of the catalog's licences, or `source-terms` when the publisher states none. */
  licence: string;
  /** Topic keys of the catalog. */
  topics: string[];
  /** How the publisher asks to be credited, when they say. */
  attribution?: string;
  createdAt: string;
  updatedAt: string;
}

/** A feed without the status its runner reports: what the Registry stores and what a runner is configured with. */
export function feedDefinition(feed: Feed): Feed {
  const {
    cooldownUntil: _cooldown,
    checkpoint: _checkpoint,
    backfill: _backfill,
    nextRunAt: _next,
    lastAttemptAt: _attempt,
    lastSuccessAt: _success,
    lastAcquisitionStatus: _last,
    lastError: _error,
    consecutiveFailures: _failures,
    running: _running,
    historyBacklog: _backlog,
    sourceUrl: _source,
    ...definition
  } = feed;
  return definition;
}

/** Equal for two definitions of a feed that differ only in when they were written. */
export function definitionFingerprint(feed: Feed): string {
  const { createdAt: _created, updatedAt: _updated, ...definition } = feedDefinition(feed);
  return canonicalJson(definition);
}

/** A feed definition without its write times: what fingerprints compare. */
type Fingerprinted = Omit<Feed, "createdAt" | "updatedAt">;

/** JSON with object members sorted, so member order never looks like a change. */
function canonicalJson(value: Fingerprinted): string {
  return JSON.stringify(value, (_key: string, item: JsonValue) => (isJsonObject(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));
}

/** What the Registry keeps about every product: the index the public API lists from. */
export interface ProductIndexEntry {
  id: string;
  slug: string;
  feedId: string;
  productKey: string;
  title: string;
  description: string;
  role: ProductRole;
  kind: "record" | "series";
  schema: CanonicalSchema;
  updateMode: ProductUpdateMode;
  completeness: Completeness;
  version: number;
  status: "current" | "failed";
  currentAcquisitionId: string | null;
  watermark: string | null;
  rowCount: number;
  /** The ordered content-addressed chunks a record product is served from; null until materialized, and for series. */
  chunks: ManifestChunk[] | null;
  /**
   * A located record product whose chunks are ordered by place and boxed: the
   * box all its rows cover, or null when none has a place. Absent for any
   * other product, and for a located one whose chunks predate spatial order
   * until its runner rebuilds them (`spatialIndexMissing`).
   */
  extent?: Box | null;
  /** Rolling window of record changes, when the product keeps them. */
  changesKey: string | null;
  /** Rolling window of series points and corrections, for time-series products. */
  seriesKey: string | null;
  seriesChangesKey: string | null;
  updatedAt: string;
  createdAt: string;
}

/** A product without its chunk list: what product lists carry. */
export type ProductSummary = Omit<ProductIndexEntry, "chunks">;

/** A located record product (a geometry, or a latitude/longitude pair) answers what is at a point. */
export function isLocated(entry: Pick<ProductIndexEntry, "kind" | "schema">): boolean {
  return entry.kind === "record" && locatorFor(entry.schema) !== undefined;
}

/** Put a located product's extent on its entry, or take it off when it is not known; returns the entry. */
export function setExtent<Entry extends Pick<ProductIndexEntry, "extent">>(entry: Entry, extent: Box | null | undefined): Entry {
  if (extent === undefined) delete entry.extent;
  else entry.extent = extent;
  return entry;
}

/**
 * A located product served from chunks that are not yet ordered by place and
 * boxed: those written before spatial order existed. Its runner rebuilds them
 * (`RunnerCore.indexSpatially`); until then a point lookup reads it whole.
 */
export function spatialIndexMissing(entry: Pick<ProductIndexEntry, "kind" | "schema" | "chunks" | "extent">): boolean {
  return isLocated(entry) && entry.chunks !== null && entry.extent === undefined;
}

/**
 * Whether a product's revisions are history: written to the lake, kept in its
 * recent change windows, and served by the history API. The one rule every
 * part of the kernel asks.
 */
export function keepsHistory(policy: CollectionPolicyDefinition, productKey: string): boolean {
  return policy.historyMode === "changes" && !(policy.withoutHistory ?? []).includes(productKey);
}

export type LiveEventKind = "backfill" | "failed" | "published" | "unchanged";

/** What runners report to the Registry's activity mirror. */
export interface LiveEvent {
  kind: LiveEventKind;
  feedId: string;
  feedSlug: string;
  acquisitionId?: string;
  at: string;
  detail?: JsonObject;
  status?: FeedStatus;
}

export type AcquisitionStatus = "failed" | "queued" | "running" | "succeeded" | "unchanged";

/** One logical collection attempt, including what its normalizer reported. */
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
  /** Normalized rows received. */
  rows?: number;
  /** Meaningful revisions this acquisition produced. */
  revisions?: number;
  /** History rows committed for delivery to the lake (zero when sampling skipped this one). */
  historyRows?: number;
  error?: string;
  /** What the Gatekeeper said went wrong, when it was the Gatekeeper that said so. */
  errorCode?: CollectionFailureCode;
}
