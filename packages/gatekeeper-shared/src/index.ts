import type { WorkerEntrypoint } from "cloudflare:workers";

import { asNonEmptyString } from "./json";

import type { JsonObject } from "./json";
import type { Licence } from "./licences";
import type { Publisher } from "./publishers";

/*
 * The package surface, named one export at a time: everything a Gatekeeper or
 * the kernel may use. What a module exports only so a sibling module can reach
 * it stays off this list.
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
  parseJson,
  parseJsonBytes,
  toJsonObject,
  type JsonObject,
  type JsonValue,
} from "./json";
export {
  SOURCE_KEY,
  buildLibrary,
  libraryCollector,
  libraryConfig,
  libraryFeedKinds,
  resolveLibraryFeed,
  type GatekeeperLibraries,
  type GatekeeperLibrary,
  type Library,
  type LibraryDeployment,
  type R2BucketDeployment,
} from "./library";
export { lisbonDay, lisbonInstants, lisbonOffsetMinutes, lisbonToUtc } from "./lisbon-time";
export { r2Staging, type SourceStaging } from "./staging";
export { LICENCES, UNSTATED_LICENCE, isLicence, type Licence, type LicenceDescription } from "./licences";
export { PUBLISHERS, isPublisher, type Publisher, type PublisherDescription } from "./publishers";
export { TOPICS, isTopic, type Topic } from "./topics";
export {
  BUFFERED_SOURCE_MAX_BYTES,
  bufferedTransform,
  collectNormalized,
  hashSourceConfig,
  resolveFeed,
  responseValidator,
  sourceValidator,
  type NormalizedCollector,
} from "./normalized";
export {
  NormalizedInputError,
  assertCollectionResult,
  assertHistoryProgress,
  assertResolvedFeed,
  historyCursorKey,
  isNormalizedFrame,
  isPermanentCollectionError,
  isProductSlug,
} from "./normalized-validation";
export {
  allowedHosts,
  contentEtag,
  equivalentEtags,
  fixedOrigin,
  hashString,
  invalidResponse,
  isoDate,
  readBoundedJson,
  readBoundedResponse,
  retryAfterSeconds,
  sha256Hex,
} from "./source-http";
export { readBoundedBytes, toByteStream } from "./stream";
export { streamCsvRecords, streamCsvRows, type CsvStreamOptions } from "./stream-csv";
export { streamJsonArray, streamNdjson, type JsonArrayPath, type JsonArrayStream, type JsonArrayStreamOptions } from "./stream-json";
export { field, runTransformer, type Transformer, type UnstampedResult } from "./transformer";

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
export type Completeness = "complete" | "partial" | "unknown";

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
  /**
   * Which slice of the product this row belongs to, for a source too large to
   * read in one sitting. A feed that reads a few municipalities a run names the
   * municipality here; with `partitionsRead` on the finalization, that is what
   * lets a run be authoritative over the ground it covered without claiming
   * anything about the ground it did not.
   *
   * It is not part of the row's identity — two runs of the same slice hold the
   * same entity keys — and the kernel never reads it from the payload. A feed
   * that reads its source whole has no use for it.
   */
  partition?: string;
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

/** Internal pure-normalizer context assembled by the Gatekeeper after acquisition. */
export interface TransformContext {
  feed: { slug: string; title: string; description: string; config: SourceConfig; semantics: FeedSemantics };
  observedAt: string;
}

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
  /**
   * The slices this collection read in full, named as the rows name them.
   *
   * A partial snapshot says "here are some rows" and can never retract, so a
   * feed built up a few municipalities a run could hold a parcel's boundary
   * for ever after the parcel was deleted. Declaring the slices read turns that
   * into a bounded claim: every row of these partitions was sent, so one the
   * kernel still holds within them is gone, while everything outside them is
   * untouched. It is authority over the ground covered, which is what a sliced
   * source has and what neither snapshot mode could express.
   *
   * Only meaningful on a `partial-snapshot`, and only for partitions whose rows
   * this collection actually carried.
   */
  partitionsRead?: string[];
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

/** The catalog is public by construction; a policy only says under what terms. */
export interface ServingPolicyDefinition {
  /** The terms the products are served under, a key of `LICENCES`. */
  licence: Licence;
  attribution?: string;
}

/** A ready-to-install feed a Gatekeeper ships as an example of what it can do. */
export interface ExampleFeed {
  slug: string;
  title: string;
  description: string;
  config: SourceConfig;
  policy: { name: string; version: number; collection: CollectionPolicyDefinition; serving: ServingPolicyDefinition };
  staleAfterSeconds: number;
  /** Who made the data, a key of `PUBLISHERS`: never the portal it was read from. */
  publisher: Publisher;
  /** Free-form topics the catalog groups and filters by, most specific first (for example "energy"). */
  topics?: string[];
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

/** Five-operation, normalized-only private RPC. */
export interface FeedGatekeeper extends WorkerEntrypoint {
  describe(): Promise<GatekeeperDescription>;
  listFeedKinds(): Promise<FeedKindDescription[]>;
  resolveFeed(config: SourceConfig): Promise<ResolvedFeed>;
  collect(request: CollectionRequest): Promise<CollectionResult>;
  exampleFeeds(): Promise<ExampleFeed[]>;
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

export function requireString(record: JsonObject, key: string): string {
  const value = asNonEmptyString(record[key]);
  if (value === undefined) {
    throw new Error(`Expected ${key} to be a non-empty string`);
  }
  return value;
}

export function optionalString(record: JsonObject, key: string): string | undefined {
  return asNonEmptyString(record[key]);
}
