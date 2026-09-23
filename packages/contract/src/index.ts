import type { WorkerEntrypoint } from "cloudflare:workers";

import type { JsonObject } from "./json";
import type { CanonicalRecord, CanonicalSchema, Completeness, ProductFinalization, ProductRole, ProductUpdateMode, SeriesPoint, TransformQuality } from "./data";

/*
 * The contract between the kernel and the Gatekeeper: the private RPC, the
 * normalized stream it answers with. The kernel depends on this package and
 * never on the Gatekeeper; nothing here fetches or parses a source. The catalog
 * — publishers, datasets, licences, topics — is the Gatekeeper's to declare, in
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
  RecordOperation,
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
  isPermanentCollectionError,
  isProductSlug,
} from "./validation";

export type SourceConfig = Record<string, string>;

export interface SourceValidator {
  etag?: string;
  lastModified?: string;
}

/** A kernel-owned scope envelope around bounded, source-owned JSON state. */
export interface SourceCheckpoint {
  version: 2;
  resourceKey: string;
  configHash: string;
  feedEpoch: string;
  normalizer: { id: string; version: string };
  state: JsonObject;
}

export interface GatekeeperDescription {
  kind: string;
  name: string;
}

type FeedDomainSubject = "coverage" | "document" | "event" | "feature" | "media" | "observation" | "reference";

/** What a feed is about, and what its products are by default. Everything else about a feed is its policy's business. */
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
}

export interface FeedKindDescription {
  kind: string;
  title: string;
  description: string;
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

/** Which live collections send their revisions to the lake. Omit it to send none. */
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
 * permission is not in the catalog, and neither are its datasets or feeds.
 */
export interface CatalogPublisher {
  id: string;
  name: string;
  /** Their own site, not the portal the data was read from. */
  url?: string;
  /** Their mark's file extension; the site serves it at `/publishers/<id>.<logo>`. */
  logo?: "svg" | "png";
}

/** A set of terms a dataset is served under, one key per set, as the publisher states them. */
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

/** One publisher's body of data, which one or more feeds read. */
export interface CatalogDataset {
  id: string;
  title: string;
  description: string;
  /** A publisher's `id`. */
  publisher: string;
  /** A licence's `id`, or `source-terms` when the publisher states none. */
  licence: string;
  /** How the publisher asks to be credited, when they say. */
  attribution?: string;
  /** Topic `id`s. */
  topics: string[];
}

/** Everything the catalog names, as the Gatekeeper declares it; the kernel stores it and serves it expanded. */
export interface CatalogDescription {
  publishers: CatalogPublisher[];
  licences: CatalogLicence[];
  topics: CatalogTopic[];
  datasets: CatalogDataset[];
}

/** The licence key for data whose publisher states no reuse terms: not a licence, so no markup names one. */
export const UNSTATED_LICENCE = "source-terms";

/**
 * A ready-to-install feed a Gatekeeper ships as an example of what it can do.
 * What the data is, who published it and under what terms belongs to its
 * dataset; a feed says only how a part of that dataset is read, and how often.
 */
export interface ExampleFeed {
  slug: string;
  /** The dataset this feed reads part of, a key of `DATASETS`. */
  dataset: string;
  /** What this feed is within its dataset. Absent when the feed is the whole of it, and the dataset's own title and description stand. */
  title?: string;
  description?: string;
  config: SourceConfig;
  policy: { name: string; version: number; collection: CollectionPolicyDefinition };
  staleAfterSeconds: number;
}

export const NORMALIZED_PROTOCOL = "open-data-normalized/4" as const;

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
  frameBytes: number;
  recordBytes: number;
  records: number;
  products: number;
}

export interface CollectionRequest {
  protocol: typeof NORMALIZED_PROTOCOL;
  collectionId: string;
  feed: { id: string; slug: string; title: string; description: string };
  resolved: ResolvedFeed;
  feedEpoch: string;
  checkpoint?: SourceCheckpoint;
  mode: { kind: "live" } | { kind: "history"; cursor: HistoryCursor };
  limits: CollectionLimits;
  deadline: string;
  /** When the kernel asked; a sampled observation's clock, never a source event time. */
  observedAt: string;
}

export interface NormalizedProductHeader {
  productKey: string;
  suggestedSlug: string;
  title: string;
  description: string;
  role: ProductRole;
  schema: CanonicalSchema;
  kind: "record" | "series";
  updateMode: ProductUpdateMode;
  /** Declared completeness combined with the source body's completeness. The kernel downgrades it when rows were rejected. */
  completeness: Completeness;
  watermark?: string;
}

/** `protocol-mismatch`: kernel and Gatekeeper run different releases, as they do for a minute during a deploy; retried, never a cooldown. */
export type CollectionFailureCode = GatekeeperError["code"] | "deadline-exceeded" | "history-unsupported" | "protocol-mismatch";
export type CollectionResult =
  | { kind: "unchanged"; checkpoint: SourceCheckpoint }
  | { kind: "batch"; stream: ReadableStream<Uint8Array> }
  | { kind: "exhausted" }
  | { kind: "failure"; code: CollectionFailureCode; retryable: boolean; retryAfterSeconds?: number };

export type NormalizedFrame =
  | {
      type: "header";
      protocol: typeof NORMALIZED_PROTOCOL;
      collectionId: string;
      normalizer: { id: string; version: string };
      products: NormalizedProductHeader[];
      provenance: SourceProvenance;
      /** Whether the body behind this batch was the source's whole scope for the feed. */
      completeness: Completeness;
      checkpoint: SourceCheckpoint;
    }
  | { type: "record"; productKey: string; value: CanonicalRecord }
  | { type: "point"; productKey: string; value: SeriesPoint }
  | {
      type: "complete";
      counts: { records: number; points: number };
      quality: TransformQuality;
      products?: ProductFinalization[];
      nextCursor?: HistoryCursor;
      exhausted?: boolean;
    };

/** The Gatekeeper's private RPC: its feed kinds, its catalog and example feeds, and normalized collection. */
export interface FeedGatekeeper extends WorkerEntrypoint {
  describe(): Promise<GatekeeperDescription>;
  listFeedKinds(): Promise<FeedKindDescription[]>;
  resolveFeed(config: SourceConfig): Promise<ResolvedFeed>;
  collect(request: CollectionRequest): Promise<CollectionResult>;
  exampleFeeds(): Promise<ExampleFeed[]>;
  catalog(): Promise<CatalogDescription>;
  /**
   * A digest of everything the three calls above answer: it changes exactly
   * when a release changes the catalog, the feeds or their kinds, so the
   * kernel can sync the moment a new Gatekeeper answers instead of on its
   * schedule. A method of its own, so a kernel that never asks is unaffected.
   */
  catalogVersion(): Promise<string>;
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
