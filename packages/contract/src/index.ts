import type { WorkerEntrypoint } from "cloudflare:workers";

import type { JsonObject } from "./json";
import type { CanonicalRecord, Completeness, ProductDeclaration, ProductFinalization, ProductRole, SeriesPoint, TransformQuality } from "./data";

/*
 * The contract between the kernel and the Gatekeeper: the private RPC, the
 * normalized stream it answers with. The kernel depends on this package and
 * never on the Gatekeeper; nothing here fetches or parses a source. The catalog
 * — publishers, their feeds, licences, topics — is the Gatekeeper's to declare, in
 * its publisher folders; this package only says what shape it crosses RPC in.
 */
export {
  asArray,
  asArrayOrEmpty,
  asBoolean,
  asNumber,
  asNumberLike,
  asNumberList,
  asObject,
  asString,
  asStringList,
  isJsonArray,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  optionalString,
  parseJson,
  parseJsonBytes,
  requireString,
  toJsonObject,
  type JsonObject,
  type JsonValue,
} from "./json";
export { canonicalSourceConfig, hashSourceConfig } from "./source-config";
export type {
  CanonicalField,
  CanonicalRecord,
  CanonicalSchema,
  Completeness,
  FieldDisplay,
  FieldType,
  NormalizedRow,
  ProductBuild,
  ProductDeclaration,
  ProductFinalization,
  ProductRole,
  ProductUpdateMode,
  RecordProductBuild,
  SeriesPoint,
  SeriesProductBuild,
  StreamingSummary,
  StreamingTransform,
  TransformQuality,
  TransformResult,
} from "./data";
export {
  NormalizedInputError,
  assertCollectionResult,
  assertHistoryProgress,
  assertResolvedFeed,
  assertSourceCheckpoint,
  historyCursorKey,
  isNormalizedFrame,
  isCollectionFailureCode,
  isPermanentCollectionError,
  isProductSlug,
} from "./validation";

export type SourceConfig = Record<string, string>;

export interface SourceValidator {
  etag?: string;
  lastModified?: string;
}

/**
 * Bounded, source-owned JSON state and the normalizer that wrote it: the same
 * shape both ways. The kernel keeps it for one feed configuration and epoch and
 * drops it when either changes; the Gatekeeper uses it only when the normalizer
 * that wrote it is still the one it runs.
 */
export interface SourceCheckpoint {
  normalizer: { id: string; version: string };
  state: JsonObject;
}

type FeedDomainSubject = "coverage" | "document" | "event" | "feature" | "media" | "observation" | "reference";

/**
 * What a feed is about, and what its products are by default: the Gatekeeper's to know. The kernel is told only
 * whether its facts are events or observations (`CatalogFeed.eventTimed`).
 */
export interface FeedSemantics {
  domainSubject: FeedDomainSubject;
  defaultProductRole: ProductRole;
}

/**
 * A feed kind can hand out history older than what `collect` returns. The
 * kernel walks it backwards once, into the lake only; live collection keeps
 * only adding what is new.
 */
export interface HistoryCapability {
  /** Earliest event time the source holds, ISO 8601, when the source states it. */
  earliest?: string;
  /**
   * The least time between two history slices of one feed, which the kernel
   * keeps on top of its own pacing: what the source can take when a slice
   * costs it many requests or slow queries. A walk sends its whole history
   * one slice at a time, so this is what decides how hard it is read.
   */
  minSliceSeconds?: number;
}

/** One kind of feed a library reads: what its facts are about, and how far back its history reaches. */
export interface FeedKindDescription {
  kind: string;
  semantics: FeedSemantics;
  history?: HistoryCapability;
}

/** Where a history walk is; opaque `token` lets a source carry its own state. */
export interface HistoryCursor {
  /** Exclusive upper bound on event time for the next slice, ISO 8601 UTC. */
  before: string;
  offset?: number;
  token?: string;
}

/* ---------- Source fetches (what an adapter hands the shared collector) ---------- */

export interface SourceProvenance {
  /**
   * The source link the site shows: the URL fetched when a browser can open it, otherwise the
   * publisher's documentation or landing page (an API behind keys, or one that answers only POSTs).
   */
  sourceUrl: string;
  sourcePublishedAt?: string;
}

/** A source body plus everything the collector must know about it. No HTTP header side-channel. */
export interface SourceBody {
  kind: "body";
  body: ReadableStream<Uint8Array> | Uint8Array;
  provenance: SourceProvenance;
  /** Whether this body is the source's whole scope for the feed. */
  completeness: Completeness;
  /** History only: the next older slice. Exactly one of `next` or `exhausted` on history bodies. */
  next?: HistoryCursor;
  exhausted?: boolean;
  /** Transport validators for the next conditional request. */
  validator?: SourceValidator;
  /** Replaces the source-owned checkpoint state; `{}` drops validators a source has stopped honouring. */
  state?: JsonObject;
}

/** Live only: the source confirmed nothing changed since the checkpoint's validators. */
export interface SourceNotModified {
  kind: "not-modified";
  validator?: SourceValidator;
}

/** History only: the source holds nothing older than the cursor. */
export interface SourceExhausted {
  kind: "exhausted";
}

export type SourceFetch = SourceBody | SourceNotModified | SourceExhausted;

/** Internal pure-normalizer context assembled by the Gatekeeper after acquisition. */
export interface TransformContext {
  feed: { slug: string; title: string; description: string; config: SourceConfig; semantics: FeedSemantics };
  observedAt: string;
}

/* ---------- Policies (values a Gatekeeper may suggest; the kernel owns and enforces them) ---------- */

/** How a feed is collected: how often, for how long, how much it may read, and whether its changes are history. */
export interface CollectionPolicyDefinition {
  cadenceSeconds: number;
  timeoutSeconds: number;
  /** Maximum source bytes the Gatekeeper may consume. */
  maxBytes: number;
  /** Maximum normalized stream bytes accepted by the kernel. Default: min(16 MiB, 4 × maxBytes). */
  maxOutputBytes?: number;
  /** Maximum serialized bytes for one normalized record or point. */
  maxRecordBytes?: number;
  /** Maximum normalized rows in one logical slice. */
  maxRecords?: number;
  /**
   * `latest`: current state only. `changes`: every meaningful revision is
   * history: written to the lake, kept in the recent change windows and served
   * by the history API.
   */
  historyMode: "changes" | "latest";
  /**
   * Products, by product key, that keep no history even under `changes`: their
   * current state is served as usual, their revisions are not recorded. For
   * things that move rather than change (vehicle positions) and for copies of
   * values another product of the feed already records.
   */
  withoutHistory?: readonly string[];
}

/* ---------- The catalog (what the Gatekeeper reads, whose it is, and under what terms) ---------- */

/**
 * Who made the data, as the Gatekeeper's publisher folders declare them. Only
 * the publishers whose data may be republished cross RPC: one held for
 * permission is not in the catalog, and neither are its feeds.
 */
export interface CatalogPublisher {
  id: string;
  name: string;
  /** Their own site, not the portal the data was read from. */
  url?: string;
  /** Their mark's file extension; the site serves it at `/publishers/<id>.<logo>`. */
  logo?: "svg" | "png";
}

/** A set of terms a feed is served under, one key per set, as the publisher states them. */
export interface CatalogLicence {
  id: string;
  /** Short enough for a badge. */
  name: string;
  /** The licence text or the publisher's terms page, when there is one. */
  url?: string;
  /** One sentence on what the terms allow, for the licence page. */
  summary: string;
}

/** A browsing tag. */
export interface CatalogTopic {
  id: string;
  name: string;
}

/**
 * Everything the Gatekeeper reads and under what terms: the publishers whose data may be republished, the
 * vocabularies their feeds name, and every feed, already resolved. The kernel installs exactly these feeds.
 */
export interface CatalogDescription {
  publishers: CatalogPublisher[];
  licences: CatalogLicence[];
  topics: CatalogTopic[];
  feeds: CatalogFeed[];
}

/** The licence key for data whose publisher states no reuse terms: not a licence, so no markup names one. */
export const UNSTATED_LICENCE = "source-terms";

/**
 * One feed, as its publisher's folder declares it and its library resolves it: what it is, whose it is and under
 * what terms, what it reads, and how it is collected. Nothing of its configuration crosses: the Gatekeeper collects
 * it by slug.
 */
export interface CatalogFeed {
  slug: string;
  /** The key of the publisher whose folder declares it: who made the data, never the portal it was read from. */
  publisher: string;
  /** The library that reads it: how, never what or whose. */
  library: string;
  title: string;
  description: string;
  /** The terms the publisher states for it: a licence's `id`, or `source-terms` when they state none. */
  licence: string;
  /** How the publisher asks to be credited, when they say. */
  attribution?: string;
  /** Topic `id`s: what the catalog groups and filters by. */
  topics: string[];
  /** What it reads, `<library>:<library>:<kind>:<digest>`: its checkpoint and the history of what it read hang on it. */
  resourceKey: string;
  /** Digest of its whole canonical configuration: a new one is another configuration of the same resource. */
  configHash: string;
  /**
   * Whether its facts are events or observations, which arrive soon after they happen: a history window then need
   * not look at what was ingested long before it.
   */
  eventTimed: boolean;
  /** Present when the source hands out history older than a live collection returns. */
  history?: HistoryCapability;
  policy: CollectionPolicyDefinition;
  /** After how long without a successful collection the feed is shown as late. */
  staleAfterSeconds: number;
}

export const NORMALIZED_PROTOCOL = "open-data-normalized/5" as const;

export interface ResolvedFeed {
  config: SourceConfig;
  /** Digest of the full canonical configuration; unlike resourceKey, this includes normalization-affecting presentation options. */
  configHash: string;
  resourceKey: string;
  kind: string;
  semantics: FeedSemantics;
  history?: HistoryCapability;
}

export interface CollectionLimits {
  sourceBytes: number;
  outputBytes: number;
  recordBytes: number;
  records: number;
}

/** The most products one collection may declare. */
export const MAX_PRODUCTS = 64;

/** The longest line of a normalized stream: one record and its frame, or a header of product declarations. */
export function frameBytesFor(limits: Pick<CollectionLimits, "outputBytes" | "recordBytes">): number {
  return Math.min(limits.outputBytes, limits.recordBytes + 16 * 1024);
}

/** One collection of one feed. The Gatekeeper reads the feed its own catalog names by `slug`. */
export interface CollectionRequest {
  protocol: typeof NORMALIZED_PROTOCOL;
  slug: string;
  /** The configuration the kernel installed; a Gatekeeper holding another one answers `feed-changed`. */
  configHash: string;
  checkpoint?: SourceCheckpoint;
  mode: { kind: "live" } | { kind: "history"; cursor: HistoryCursor };
  limits: CollectionLimits;
  deadline: string;
  /** When the kernel asked; a sampled observation's clock, never a source event time. */
  observedAt: string;
}

/**
 * `protocol-mismatch` and `feed-changed`: kernel and Gatekeeper run different releases, or the kernel has not synced
 * the Gatekeeper's new catalog yet, as happens for a minute during a deploy; retried, never a cooldown.
 */
export type CollectionFailureCode = GatekeeperError["code"] | "deadline-exceeded" | "feed-changed" | "history-unsupported" | "protocol-mismatch";
export type CollectionResult =
  | { kind: "unchanged"; checkpoint: SourceCheckpoint }
  | { kind: "batch"; stream: ReadableStream<Uint8Array> }
  | { kind: "exhausted" }
  | { kind: "failure"; code: CollectionFailureCode; retryable: boolean; retryAfterSeconds?: number };

export type NormalizedFrame =
  | {
      type: "header";
      /** Each product's completeness already folds in whether the body was the source's whole scope. */
      products: ProductDeclaration[];
      provenance: SourceProvenance;
      /** The state for the next collection, and the normalizer that produced this batch. */
      checkpoint: SourceCheckpoint;
    }
  | { type: "record"; productKey: string; value: CanonicalRecord }
  | { type: "point"; productKey: string; value: SeriesPoint }
  | {
      type: "complete";
      quality: TransformQuality;
      products?: ProductFinalization[];
      nextCursor?: HistoryCursor;
      exhausted?: boolean;
    };

/** The Gatekeeper's private RPC: its catalog, a digest of it, and normalized collection. */
export interface FeedGatekeeper extends WorkerEntrypoint {
  catalog(): Promise<CatalogDescription>;
  /**
   * A digest of the catalog: it changes exactly when a release changes the publishers, the vocabularies or the
   * feeds, so the kernel syncs the moment a new Gatekeeper answers instead of on its schedule.
   */
  catalogVersion(): Promise<string>;
  collect(request: CollectionRequest): Promise<CollectionResult>;
}

export class GatekeeperError extends Error {
  readonly code: "invalid-config" | "source-denied" | "upstream-error" | "invalid-response" | "response-too-large";
  readonly retryAfterSeconds: number | undefined;

  constructor(message: string, code: GatekeeperError["code"], retryAfterSeconds?: number) {
    super(message);
    this.name = "GatekeeperError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}
