import { isJsonObject } from "@open-data-pt/gatekeeper-shared";
import type {
  CanonicalSchema,
  CollectionPolicyDefinition,
  Completeness,
  FeedSemantics,
  JsonObject,
  JsonValue,
  ProductRole,
  ProductUpdateMode,
  ResolvedFeed,
  ServingPolicyDefinition,
  SourceCheckpoint,
  SourceConfig,
  TransformQuality,
} from "@open-data-pt/gatekeeper-shared";

import type { ManifestChunk } from "./chunks";

export interface FeedPolicy {
  id: string;
  name: string;
  version: number;
  collection: CollectionPolicyDefinition;
  serving: ServingPolicyDefinition;
  createdAt: string;
}

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
  /** The library that reads the feed: the `source` key of its configuration. */
  library: string;
  config: SourceConfig;
  semantics: FeedSemantics;
  /** Semantic collection generation, independent of administrative edits. */
  feedEpoch: string;
  resolved: ResolvedFeed;
  policyId: string;
  enabled: boolean;
  staleAfterSeconds: number;
  /** Who made the data, a key of `PUBLISHERS`; the API serves it expanded. */
  publisher: string;
  /** Topics the catalog filters by, supplied by the Gatekeeper, never by the kernel. */
  topics: string[];
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
    ...definition
  } = feed;
  return definition;
}

/** Equal for two definitions of a feed that differ only in when they were written. */
export function definitionFingerprint(feed: Feed): string {
  const { createdAt: _created, updatedAt: _updated, ...definition } = feedDefinition(feed);
  return canonicalJson(definition);
}

/** Equal for two copies of a policy that differ only in when they were written. */
export function policyFingerprint(policy: FeedPolicy): string {
  const { createdAt: _created, ...definition } = policy;
  return canonicalJson(definition);
}

/** A feed definition or policy without its write times: what fingerprints compare. */
type Fingerprinted = Omit<Feed, "createdAt" | "updatedAt"> | Omit<FeedPolicy, "createdAt">;

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

/**
 * Whether a product's revisions are history: written to the lake, kept in its
 * recent change windows, and served by the history API. The one rule every
 * part of the kernel asks.
 */
export function keepsHistory(policy: Pick<FeedPolicy, "collection">, productKey: string): boolean {
  return policy.collection.historyMode === "changes" && !(policy.collection.withoutHistory ?? []).includes(productKey);
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
  policyVersion: number;
  error?: string;
}
