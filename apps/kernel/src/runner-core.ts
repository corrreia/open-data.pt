import {
  NormalizedInputError,
  historyCursorKey,
  isPermanentCollectionError,
  type CollectionLimits,
  type Completeness,
  type HistoryCursor,
  type JsonObject,
  type NormalizedProductHeader,
  type SourceCheckpoint,
  type TransformQuality,
} from "@open-data-pt/gatekeeper-shared";

import { chunkIndexFor, chunkListProblem, parseChunkRows, regenerateChunks, servedIdentity, type ChunkSink, type ServingRow } from "./chunks";
import {
  definitionFingerprint,
  feedDefinition,
  keepsHistory,
  policyFingerprint,
  type Acquisition,
  type AcquisitionStatus,
  type BackfillSummary,
  type Feed,
  type FeedPolicy,
  type FeedStatus,
  type ProductIndexEntry,
} from "./feed-model";
import { digest } from "./hash";
import type { LakeTable } from "./lake";
import { keys, WINDOW, type ChangeItem, type ObjectStore } from "./object-store";
import { jsonArrays, MAX_RECORD_BYTES, utf8Length } from "./blob-budget";
import { RecentChanges, recordRevision, retractionRevision, type PreparedRecord, type RecordContext } from "./records";
import { dropAllTables, userTables } from "./sqlite-reset";

/**
 * Everything one FeedRunner Durable Object owns, as plain logic over its
 * SQLite database: schedule and checkpoint, acquisitions, product entries,
 * the entity index of large record products, staged changes, and the history
 * outbox. The Durable Object is a thin wrapper; collection work runs elsewhere
 * (a Workflow) and reaches this core through small RPC calls.
 */

export const RUNNER_SCHEMA_VERSION = 202;
/** Products up to this many rows are compared in memory by the executor; larger ones use the SQLite entity index. */
export const SMALL_PRODUCT_ROWS = 20_000;
const MAX_RETRY_BACKOFF_SECONDS = 15 * 60;
const INTERRUPTIONS_BEFORE_COOLDOWN = 3;
/**
 * A feed that fails permanently, or keeps being killed, waits this long before
 * retrying the same acquisition by itself; each repeat doubles it, up to the maximum.
 */
export const COOLDOWN_BASE_MS = 6 * 60 * 60_000;
export const COOLDOWN_MAX_MS = 48 * 60 * 60_000;
const BACKFILL_MAX_FAILURES = 5;
/** A feed's one history walk starts this long after its first successful live collection. */
export const BACKFILL_START_DELAY_MS = 10 * 60_000;
/** A history walk goes back to the source's stated beginning, but never further than this many years. */
export const BACKFILL_MAX_YEARS = 10;
/** A walk paused by repeated transient failures resumes by itself after this long. */
export const BACKFILL_RESUME_MS = 24 * 60 * 60_000;
/** A walk stopped by a permanent failure tries again after this long, in case the Gatekeeper was fixed. */
export const BACKFILL_RETRY_FAILED_MS = 7 * 24 * 60 * 60_000;
const MAX_SEEN = 10_000;
/** Undelivered history, in UTF-8 bytes, above which a feed takes no new work. */
const PENDING_MAX_BYTES = 64 * 1024 * 1024;
/** Retries a failing collection takes at exponential backoff before it falls back to its ordinary cadence. */
const RETRY_LIMIT = 3;
const LOOKUP_BATCH = 2_000;
/** Superseded serving objects are deleted this long after they stop being selectable: an edge-cached read may still name them. */
const GARBAGE_GRACE_MS = 60 * 60_000;
/** How long past its own timeout an executor may stay silent before the watchdog asks the Workflow about it. */
const WATCHDOG_MARGIN_SECONDS = 300;

export interface RunnerState {
  checkpoint?: SourceCheckpoint;
  /** Until when nothing runs after a permanent failure or repeated executor kills. */
  cooldownUntil?: string;
  /** The acquisition retried when the cooldown ends. */
  cooldownAcquisitionId?: string;
  /** Consecutive cooldowns; each one doubles the wait. A success resets it. */
  cooldowns?: number;
  runningAcquisitionId?: string;
  /** The executor instance (Workflow instance id) running it. */
  runningInstanceId?: string;
  /** When the running acquisition must have reported back. */
  watchdogAt?: string;
  nextRunAt?: string;
  lastAttemptAt?: string;
  lastSuccessAt?: string;
  /** Where the latest live collection read its data, for the site's source link. */
  sourceUrl?: string;
  consecutiveFailures: number;
  /** Executor deaths without a report (memory or CPU kills), across consecutive acquisitions. */
  consecutiveInterruptions: number;
}

/** A resumable source-owned historical walk. */
export interface BackfillState {
  status: "running" | "paused" | "complete" | "failed";
  cursor: HistoryCursor;
  visitedCursors: string[];
  walkId: string;
  until?: string;
  floors: Record<string, string>;
  /** Bounded overlap memory: logical row key to its latest meaningful hash. */
  seen: Record<string, string>;
  slices: number;
  points: number;
  records: number;
  failures: number;
  startedAt: string;
  updatedAt: string;
  lastError?: string;
}

export type CollectionMode = { kind: "live" } | { kind: "history"; cursor: HistoryCursor };

export interface ProductPlan {
  productKey: string;
  slug: string;
  mode: "small" | "large";
  entry: ProductIndexEntry;
  /** A large product whose committed changes still have to be rebuilt into chunks. */
  regenerate: boolean;
}

/** Everything an executor needs to run one acquisition, taken in one call. */
export interface CollectionPlan {
  kind: "run";
  acquisitionId: string;
  feed: Feed;
  policy: FeedPolicy;
  checkpoint?: SourceCheckpoint;
  mode: CollectionMode;
  visitedCursors: string[];
  backfill?: { floors: Record<string, string>; seen: Record<string, string>; until?: string };
  products: ProductPlan[];
  /** History rows go to the lake: it is bound and the policy keeps history (a history slice always does). Products the policy leaves out write none. */
  lake: boolean;
  observedAt: string;
  deadline: string;
  limits: CollectionLimits;
}

export type BeginResult = CollectionPlan | { kind: "done"; status: AcquisitionStatus };

export interface CommitResult {
  status: "succeeded" | "unchanged";
  /** History rows the collection committed to the outbox; none means there is nothing to deliver. */
  historyRows: number;
  /** The first committed blobs waiting for delivery, so the executor sends them without asking again. */
  outbox: OutboxBlob[];
}

/** Blobs a commit hands back: four of at most 900 KB stay far below the RPC payload limit. */
const COMMIT_OUTBOX_BLOBS = 4;

export interface DeclareInput {
  normalizer: { id: string; version: string };
  sourcePublishedAt?: string;
  products: NormalizedProductHeader[];
}

export interface DeclaredProduct {
  productKey: string;
  slug: string;
  kind: "record" | "series";
  /** The version this acquisition would publish. */
  version: number;
  baseline: boolean;
  mode: "small" | "large";
  previous: ProductIndexEntry | null;
}

/** One prepared record on its way into the large-product index. */
export interface StagedRecord {
  prepared: PreparedRecord;
  /** Served JSON for an upsert; null for a removal. */
  json: string | null;
}

export interface StageResult {
  /** Entity ids of rows that already existed (for the retraction sweep). */
  seen: number[];
  changes: ChangeItem[];
  revisions: number;
  /** Entity changes staged for the commit to apply. */
  staged: number;
}

export interface SweepResult {
  changes: ChangeItem[];
  revisions: number;
  removed: number;
}

export interface ProductCommit {
  productKey: string;
  changed: boolean;
  /** The entry to publish. For large record products the chunk list and row count are filled in after regeneration. */
  entry: ProductIndexEntry;
  mode: "small" | "large" | "series";
  /** Large record products with staged changes to apply. */
  staged?: boolean;
}

export interface CommitInput {
  checkpoint: SourceCheckpoint;
  normalizer: { id: string; version: string };
  quality: TransformQuality;
  completeness: Completeness;
  rows: number;
  revisions: number;
  sourcePublishedAt?: string;
  /** A page a person can open to see the source; the engine passes only plain web addresses. */
  sourceUrl?: string;
  eventTime?: string;
  products: ProductCommit[];
  history?: { nextCursor?: HistoryCursor; exhausted: boolean; floors: Record<string, string>; seen: Record<string, string>; points: number; records: number };
}

export interface CollectionFailure {
  message: string;
  retryable: boolean;
  retryAfterSeconds?: number;
  /** The executor died without finishing (memory, CPU or platform kill). */
  interrupted?: boolean;
}

export interface OutboxBlob {
  seq: number;
  table: LakeTable;
  rowsJson: string;
}

/** What the core needs from outside its database. */
export interface RunnerDeps {
  objects: ObjectStore;
  /** Atomically select these entries as the feed's complete product set. False when the Registry no longer knows the feed. */
  publish(entries: ProductIndexEntry[]): Promise<boolean>;
  claim(feedId: string, slugs: string[]): Promise<void>;
  lakeAvailable: boolean;
  now(): number;
}

type Transaction = <T>(body: () => T) => T;

export class RunnerCore {
  constructor(
    private readonly sql: SqlStorage,
    private readonly transaction: Transaction,
    private readonly deps: RunnerDeps,
  ) {}

  /* ---------- Schema ---------- */

  /** No migrations: a different schema version resets this runner; the Registry re-configures it. */
  migrate(): void {
    const current = this.tableExists("meta") ? this.rows<{ value: string }>(`SELECT value FROM meta WHERE key = 'schema_version'`)[0]?.value : undefined;
    if (current !== undefined && current !== String(RUNNER_SCHEMA_VERSION)) this.reset();
    if (current === undefined && userTables(this.sql).length > 0) this.reset();
    this.exec(`CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    this.exec(`CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value_json TEXT NOT NULL)`);
    this.exec(`CREATE TABLE IF NOT EXISTS acquisitions (
      id TEXT PRIMARY KEY, trigger TEXT NOT NULL, status TEXT NOT NULL, requested_at TEXT NOT NULL, started_at TEXT, completed_at TEXT,
      observed_at TEXT, event_time TEXT, source_published_at TEXT, completeness TEXT, normalizer_json TEXT, quality_json TEXT,
      rows INTEGER, revisions INTEGER, history_rows INTEGER, policy_version INTEGER NOT NULL, error TEXT)`);
    this.exec(`CREATE INDEX IF NOT EXISTS acquisitions_requested ON acquisitions(requested_at)`);
    this.exec(`CREATE TABLE IF NOT EXISTS products (
      product_key TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, mode TEXT NOT NULL, entry_json TEXT NOT NULL, regenerate INTEGER NOT NULL DEFAULT 0)`);
    this.exec(`CREATE TABLE IF NOT EXISTS entities (
      id INTEGER PRIMARY KEY, product_key TEXT NOT NULL, entity_key TEXT NOT NULL, hash TEXT NOT NULL, row_json TEXT NOT NULL)`);
    this.exec(`CREATE UNIQUE INDEX IF NOT EXISTS entities_key ON entities(product_key, entity_key)`);
    this.exec(`CREATE TABLE IF NOT EXISTS stage (seq INTEGER PRIMARY KEY, acquisition_id TEXT NOT NULL, product_key TEXT NOT NULL, body TEXT NOT NULL)`);
    this.exec(`CREATE INDEX IF NOT EXISTS stage_acquisition ON stage(acquisition_id, product_key)`);
    this.exec(`CREATE TABLE IF NOT EXISTS outbox (
      seq INTEGER PRIMARY KEY, acquisition_id TEXT NOT NULL, lake_table TEXT NOT NULL, rows_json TEXT NOT NULL,
      rows INTEGER NOT NULL, bytes INTEGER NOT NULL, committed INTEGER NOT NULL DEFAULT 0, committed_at TEXT)`);
    this.exec(`CREATE INDEX IF NOT EXISTS outbox_acquisition ON outbox(acquisition_id)`);
    this.exec(`CREATE TABLE IF NOT EXISTS garbage (object_key TEXT PRIMARY KEY, delete_after TEXT NOT NULL)`);
    // Every construction runs this; writing the version only when it is new keeps a warm-up free of row writes.
    if (current !== String(RUNNER_SCHEMA_VERSION))
      this.exec(`INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`, String(RUNNER_SCHEMA_VERSION));
  }

  private reset(): void {
    console.warn(JSON.stringify({ event: "runner_schema_reset", version: RUNNER_SCHEMA_VERSION }));
    dropAllTables(this.sql);
  }

  /* ---------- State ---------- */

  getState<T>(key: string): T | undefined {
    const row = this.rows<{ value_json: string }>(`SELECT value_json FROM state WHERE key = ?`, key)[0];
    // SAFETY: the state table only holds what setState wrote under this key, read back at the type it was written with.
    return row ? (JSON.parse(row.value_json) as T) : undefined;
  }

  setState<T>(key: string, value: T): void {
    this.exec(`INSERT INTO state (key, value_json) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json`, key, JSON.stringify(value));
  }

  deleteState(key: string): void {
    this.exec(`DELETE FROM state WHERE key = ?`, key);
  }

  feed(): Feed | undefined {
    return this.getState<Feed>("feed");
  }
  policy(): FeedPolicy | undefined {
    return this.getState<FeedPolicy>("policy");
  }

  runtime(): RunnerState {
    return this.getState<RunnerState>("runtime") ?? { consecutiveFailures: 0, consecutiveInterruptions: 0 };
  }

  setRuntime(state: RunnerState): void {
    this.setState("runtime", state);
  }

  requireFeed(): Feed {
    const feed = this.feed();
    if (!feed) throw new Error("This runner has no feed configured");
    return feed;
  }

  requirePolicy(): FeedPolicy {
    const policy = this.policy();
    if (!policy) throw new Error("This runner has no policy configured");
    return policy;
  }

  /* ---------- Configuration and schedule ---------- */

  /**
   * Take the feed definition and policy the Registry resolved. The same ones
   * again change nothing, so the Registry can re-send every feed daily without
   * cutting cooldowns short. Different ones are a fresh chance: a cooldown
   * ends, a stalled history walk resumes, and the feed is due now.
   * Returns whether anything changed.
   */
  configure(feed: Feed, policy: FeedPolicy): boolean {
    const wasRetiring = this.retiring();
    if (wasRetiring) this.deleteState("retiring");
    const current = this.feed();
    const currentPolicy = this.policy();
    // Adopted again after being dropped is a change too: the runner must plan its wake-ups again.
    if (current && currentPolicy && definitionFingerprint(current) === definitionFingerprint(feed) && policyFingerprint(currentPolicy) === policyFingerprint(policy))
      return wasRetiring;
    this.setState("feed", feedDefinition(feed));
    this.setState("policy", policy);
    const now = this.deps.now();
    const at = new Date(now).toISOString();
    if (this.runtime().cooldownUntil) this.endCooldown(true);
    const backfill = this.getState<BackfillState & { nextAt?: string }>("backfill");
    if (feed.resolved.history && (backfill?.status === "paused" || backfill?.status === "failed")) {
      this.setState("backfill", { ...backfill, status: "running", failures: 0, updatedAt: at, nextAt: at });
    }
    const runtime = this.runtime();
    if (feed.enabled) {
      const due = runtime.nextRunAt ? Math.min(Date.parse(runtime.nextRunAt), now) : now;
      this.setRuntime({ ...runtime, nextRunAt: new Date(due).toISOString() });
    } else {
      const { nextRunAt: _next, ...rest } = runtime;
      this.setRuntime(rest);
    }
    return true;
  }

  /** The Registry dropped this feed: take no new work; the Durable Object deletes everything once its history is delivered. */
  decommission(): void {
    this.setState("retiring", true);
  }

  retiring(): boolean {
    return this.getState<boolean>("retiring") === true;
  }

  /**
   * The next moment this runner has something to do, or null for nothing until
   * someone calls. There is no idle heartbeat: a weekly feed sleeps for a week.
   */
  nextAlarm(): number | null {
    const now = this.deps.now();
    if (this.retiring()) return now + 1000;
    const runtime = this.runtime();
    const times: number[] = [];
    const garbageDue = this.rows<{ at: string | null }>(`SELECT MIN(delete_after) AS at FROM garbage`)[0]?.at;
    if (garbageDue) times.push(Date.parse(garbageDue));
    if (runtime.watchdogAt) times.push(Date.parse(runtime.watchdogAt));
    if (this.getState<PendingPublication>("publication")) times.push(now + 60_000);
    if (this.committedOutboxRows() > 0) times.push(now + 5 * 60_000);
    if (!runtime.runningAcquisitionId && runtime.cooldownUntil) {
      times.push(Date.parse(runtime.cooldownUntil));
    } else if (!runtime.runningAcquisitionId) {
      if (this.nextQueued()) times.push(now);
      const feed = this.feed();
      if (feed?.enabled && runtime.nextRunAt) times.push(Date.parse(runtime.nextRunAt));
      const backfill = this.getState<BackfillState & { nextAt?: string }>("backfill");
      if (backfill?.status === "running") times.push(backfill.nextAt ? Date.parse(backfill.nextAt) : now);
      const resumeAt = backfill ? this.backfillResumeAt(backfill) : undefined;
      if (resumeAt !== undefined) times.push(resumeAt);
    }
    if (times.length === 0) return null;
    return Math.max(now + 1000, Math.min(...times));
  }

  /** Create the acquisition that should run now, if any. Live work comes before history. */
  takeDue(): Acquisition | undefined {
    const runtime = this.runtime();
    if (runtime.runningAcquisitionId || this.retiring()) return undefined;
    const now = this.deps.now();
    const policy = this.policy();
    if (!policy) return undefined;
    if (runtime.cooldownUntil) {
      if (Date.parse(runtime.cooldownUntil) > now + 1000) return undefined;
      // The cooldown is over: retry the acquisition that caused it, keeping the count so a repeat waits longer.
      this.endCooldown(false);
    }
    const queued = this.nextQueued();
    if (queued) return queued;
    const feed = this.feed();
    const nextRunAt = this.runtime().nextRunAt;
    if (feed?.enabled && nextRunAt && Date.parse(nextRunAt) <= now + 1000) {
      return this.createAcquisition("scheduled", policy.version);
    }
    let backfill = this.getState<BackfillState & { nextAt?: string }>("backfill");
    const resumeAt = backfill ? this.backfillResumeAt(backfill) : undefined;
    if (backfill && resumeAt !== undefined && resumeAt <= now + 1000) {
      backfill = { ...backfill, status: "running", failures: 0, updatedAt: new Date(now).toISOString(), nextAt: new Date(now).toISOString() };
      this.setState("backfill", backfill);
    }
    if (backfill?.status === "running" && (!backfill.nextAt || Date.parse(backfill.nextAt) <= now + 1000)) {
      const id = backfillAcquisitionId(this.requireFeed().id, backfill);
      if (!this.getAcquisition(id)) this.insertAcquisition(id, "history", policy.version);
      else this.exec(`UPDATE acquisitions SET status = 'queued', error = NULL WHERE id = ?`, id);
      return this.getAcquisition(id);
    }
    return undefined;
  }

  /** Mark an acquisition as handed to an executor, with a deadline for hearing back. */
  markStarted(acquisitionId: string, instanceId: string): void {
    const now = this.deps.now();
    this.exec(`UPDATE acquisitions SET status = 'running', started_at = ? WHERE id = ?`, new Date(now).toISOString(), acquisitionId);
    this.setRuntime({
      ...this.runtime(),
      runningAcquisitionId: acquisitionId,
      runningInstanceId: instanceId,
      watchdogAt: this.watchdogDeadline(),
      lastAttemptAt: new Date(now).toISOString(),
    });
  }

  private watchdogDeadline(): string {
    return new Date(this.deps.now() + (this.requirePolicy().collection.timeoutSeconds + WATCHDOG_MARGIN_SECONDS) * 1000).toISOString();
  }

  /** How many feeds of the same Gatekeeper kind are walking history; paces this runner's slices. */
  backfillPeers = 1;

  /** Every serving object this runner still references, for cleanup when its feed is gone. */
  servingKeys(): string[] {
    const found = new Set(this.productObjectKeys());
    for (const row of this.rows<{ object_key: string }>(`SELECT object_key FROM garbage`)) found.add(row.object_key);
    return [...found];
  }

  /** Serving objects referenced by one product (or all products). */
  private productObjectKeys(productKey?: string): string[] {
    const rows =
      productKey === undefined
        ? this.rows<{ entry_json: string }>(`SELECT entry_json FROM products`)
        : this.rows<{ entry_json: string }>(`SELECT entry_json FROM products WHERE product_key = ?`, productKey);
    // SAFETY: entry_json is written only from ProductIndexEntry values.
    return [...new Set(rows.flatMap((row) => objectKeysOf(JSON.parse(row.entry_json) as ProductIndexEntry)))];
  }

  /** The running acquisition whose watchdog expired, if any. */
  overdue(): string | undefined {
    const runtime = this.runtime();
    if (!runtime.runningAcquisitionId || !runtime.watchdogAt) return undefined;
    return Date.parse(runtime.watchdogAt) <= this.deps.now() ? runtime.runningAcquisitionId : undefined;
  }

  /** Give the executor more time while it is demonstrably still running. */
  extendWatchdog(acquisitionId: string): void {
    const runtime = this.runtime();
    if (runtime.runningAcquisitionId !== acquisitionId) return;
    this.setRuntime({ ...runtime, watchdogAt: this.watchdogDeadline() });
  }

  collectNow(trigger: string): Acquisition {
    const policy = this.requirePolicy();
    return this.createAcquisition(trigger, policy.version);
  }

  /** Leave the cooldown: queue its acquisition again and make the feed due now. `resetCount` forgets earlier cooldowns. */
  private endCooldown(resetCount: boolean): void {
    const runtime = this.runtime();
    const acquisitionId = runtime.cooldownAcquisitionId;
    const next: RunnerState = { ...runtime, nextRunAt: new Date(this.deps.now()).toISOString() };
    delete next.cooldownUntil;
    delete next.cooldownAcquisitionId;
    if (resetCount) {
      next.cooldowns = 0;
      next.consecutiveInterruptions = 0;
    }
    this.transaction(() => {
      if (acquisitionId) this.exec(`UPDATE acquisitions SET status = 'queued', error = NULL WHERE id = ? AND status = 'failed'`, acquisitionId);
      this.setRuntime(next);
    });
  }

  /* ---------- Collection lifecycle (called by the executor) ---------- */

  begin(acquisitionId: string): BeginResult {
    const acquisition = this.getAcquisition(acquisitionId);
    if (!acquisition) throw new Error(`Unknown acquisition ${acquisitionId}`);
    if (acquisition.status === "succeeded" || acquisition.status === "unchanged" || acquisition.status === "failed") return { kind: "done", status: acquisition.status };
    if (this.getState<PendingPublication>("publication")) throw new Error("A committed batch is still being published; retry shortly");
    const feed = this.requireFeed();
    const policy = this.requirePolicy();
    if (this.committedOutboxBytes() >= PENDING_MAX_BYTES)
      throw new Error(`History backlog reached ${PENDING_MAX_BYTES} bytes; collection paused without discarding accepted history`);
    // A retried attempt starts clean; nothing uncommitted from an earlier attempt survives.
    this.discard(acquisitionId);
    const now = this.deps.now();
    const runtime = this.runtime();
    const history = acquisition.trigger === "history";
    const backfill = history ? this.getState<BackfillState>("backfill") : undefined;
    if (history && !backfill) throw new NormalizedInputError("History acquisition has no backfill walk");
    const outputBytes = policy.collection.maxOutputBytes ?? Math.max(1024 * 1024, Math.min(16 * 1024 * 1024, policy.collection.maxBytes * 4));
    // A record is stored whole in SQLite (entity index, history outbox), so no policy may exceed MAX_RECORD_BYTES.
    const recordBytes = Math.min(policy.collection.maxRecordBytes ?? 256 * 1024, MAX_RECORD_BYTES);
    const plan: CollectionPlan = {
      kind: "run",
      acquisitionId,
      feed,
      policy,
      mode: history ? { kind: "history", cursor: backfill!.cursor } : { kind: "live" },
      visitedCursors: backfill?.visitedCursors ?? [],
      products: this.productPlans(),
      lake: this.deps.lakeAvailable && (history || policy.collection.historyMode === "changes"),
      observedAt: new Date(now).toISOString(),
      deadline: new Date(now + policy.collection.timeoutSeconds * 1000).toISOString(),
      limits: {
        sourceBytes: policy.collection.maxBytes,
        outputBytes,
        frameBytes: Math.min(outputBytes, recordBytes + 16 * 1024),
        recordBytes,
        records: policy.collection.maxRecords ?? 1_000_000,
        products: 64,
      },
    };
    if (history && !this.deps.lakeAvailable) throw new NormalizedInputError("Historical collection requires lake bindings");
    if (runtime.checkpoint && !history) plan.checkpoint = runtime.checkpoint;
    if (backfill) {
      plan.backfill = { floors: backfill.floors, seen: backfill.seen };
      if (backfill.until) plan.backfill.until = backfill.until;
    }
    this.setState(collectionKey(acquisitionId), { observedAt: plan.observedAt, lake: plan.lake } satisfies CollectionMemo);
    return plan;
  }

  /** Bind this batch's products to durable slugs and versions; claim slugs the feed has never used. */
  async declare(acquisitionId: string, input: DeclareInput): Promise<DeclaredProduct[]> {
    const feed = this.requireFeed();
    const memo = this.memo(acquisitionId);
    const declared = declareProducts(this.productPlans(), input.products);
    const fresh = declared.filter((product) => !product.previous).map((product) => product.slug);
    if (fresh.length > 0) await this.deps.claim(feed.id, fresh);
    const updated: CollectionMemo = {
      ...memo,
      normalizer: input.normalizer,
      declared: declared.map(({ productKey, slug, version, baseline }) => ({ productKey, slug, version, baseline })),
    };
    if (input.sourcePublishedAt) updated.sourcePublishedAt = input.sourcePublishedAt;
    this.setState(collectionKey(acquisitionId), updated);
    return declared;
  }

  /**
   * A small product outgrew in-memory comparison. Seed its entity index from
   * the currently served chunks so the next attempt compares against it.
   */
  async promote(productKey: string): Promise<void> {
    const product = this.productPlans().find((candidate) => candidate.productKey === productKey);
    if (!product || product.mode === "large") return;
    const rows: ServingRow[] = [];
    for (const chunk of product.entry.chunks ?? []) rows.push(...parseChunkRows((await this.deps.objects.readText(chunk.key)) ?? ""));
    this.transaction(() => {
      for (const row of rows) {
        const hash = rowHash(row.json);
        this.exec(
          `INSERT INTO entities (product_key, entity_key, hash, row_json) VALUES (?, ?, ?, ?) ON CONFLICT(product_key, entity_key) DO UPDATE SET hash = excluded.hash, row_json = excluded.row_json`,
          productKey,
          row.key,
          hash,
          row.json,
        );
      }
      this.exec(`UPDATE products SET mode = 'large' WHERE product_key = ?`, productKey);
    });
  }

  /** Classify one chunk of a large record product against its SQLite index and stage the changes. */
  stageRecords(acquisitionId: string, productKey: string, rows: StagedRecord[]): StageResult {
    const context = this.recordContext(acquisitionId, productKey);
    const latest = new Map<string, StagedRecord>();
    for (const row of rows) latest.set(row.prepared.key, row);
    const existing = this.lookup(productKey, [...latest.keys()]);
    const staged: Array<[string, string | null, string | null]> = [];
    const changes = new RecentChanges<ChangeItem>(WINDOW.changes);
    const lake: JsonObject[] = [];
    const seen: number[] = [];
    let revisions = 0;
    for (const row of latest.values()) {
      const previous = existing.get(row.prepared.key);
      if (previous) seen.push(previous.id);
      if (previous && !row.prepared.removal && previous.hash === row.prepared.hash) continue;
      if (row.prepared.removal) {
        if (previous) staged.push([row.prepared.key, null, null]);
      } else {
        if (row.json === null) throw new NormalizedInputError("An upsert must carry its served JSON");
        staged.push([row.prepared.key, row.prepared.hash, row.json]);
      }
      const revision = recordRevision(row.prepared, Boolean(previous), context);
      changes.add(revision.change);
      revisions += 1;
      if (context.keepHistory) lake.push(revision.lake);
    }
    this.transaction(() => {
      this.insertStage(acquisitionId, productKey, staged);
      this.appendLakeRows(acquisitionId, "records", lake);
    });
    return { seen, changes: changes.newestFirst(), revisions, staged: staged.length };
  }

  /** After a complete authoritative snapshot, stage removal of every indexed entity the batch did not contain. */
  sweepRecords(acquisitionId: string, productKey: string, seen: Uint8Array, retract: boolean): SweepResult {
    const context = this.recordContext(acquisitionId, productKey);
    const changes = new RecentChanges<ChangeItem>(WINDOW.changes);
    let removed = 0;
    let revisions = 0;
    let after = 0;
    while (true) {
      const page = this.rows<{ id: number; entity_key: string }>(`SELECT id, entity_key FROM entities WHERE product_key = ? AND id > ? ORDER BY id LIMIT 5000`, productKey, after);
      if (page.length === 0) break;
      after = page.at(-1)!.id;
      const staged: Array<[string, null, null]> = [];
      const lake: JsonObject[] = [];
      for (const row of page) {
        const byte = seen[row.id >> 3] ?? 0;
        if ((byte & (1 << (row.id & 7))) !== 0) continue;
        staged.push([row.entity_key, null, null]);
        removed += 1;
        if (!retract) continue;
        const revision = retractionRevision(row.entity_key, context);
        changes.add(revision.change);
        revisions += 1;
        if (context.keepHistory) lake.push(revision.lake);
      }
      this.transaction(() => {
        this.insertStage(acquisitionId, productKey, staged);
        this.appendLakeRows(acquisitionId, "records", lake);
      });
    }
    return { changes: changes.newestFirst(), revisions, removed };
  }

  /** A blob of history rows the executor prepared (small products and series). */
  appendOutbox(acquisitionId: string, table: LakeTable, rowsJson: string, rows: number): void {
    if (rows <= 0) return;
    this.exec(`INSERT INTO outbox (acquisition_id, lake_table, rows_json, rows, bytes) VALUES (?, ?, ?, ?, ?)`, acquisitionId, table, rowsJson, rows, utf8Length(rowsJson));
  }

  /**
   * Durably accept a validated batch in one transaction: apply staged entity
   * changes, save the products' new entries, commit the history outbox, advance
   * the checkpoint and schedule. Publication follows and is retried until done.
   */
  async commit(acquisitionId: string, input: CommitInput): Promise<CommitResult> {
    const acquisition = this.getAcquisition(acquisitionId);
    if (!acquisition) throw new Error(`Unknown acquisition ${acquisitionId}`);
    if (acquisition.status === "succeeded" || acquisition.status === "unchanged")
      return { status: acquisition.status, historyRows: acquisition.historyRows ?? 0, outbox: this.pendingOutbox(COMMIT_OUTBOX_BLOBS) };
    const policy = this.requirePolicy();
    const now = this.deps.now();
    const at = new Date(now).toISOString();
    const memo = this.memo(acquisitionId);
    const changed = input.products.some((product) => product.changed) || input.revisions > 0;
    const status = changed ? "succeeded" : "unchanged";
    const history = acquisition.trigger === "history";
    let historyRows = 0;
    this.transaction(() => {
      for (const product of input.products) {
        if (product.mode === "large" && product.staged) this.applyStage(acquisitionId, product.productKey);
        this.saveProduct(product, history);
      }
      if (!history) this.retireMissing(input.products.map((product) => product.productKey));
      historyRows = Number(this.rows<{ total: number | null }>(`SELECT SUM(rows) AS total FROM outbox WHERE acquisition_id = ?`, acquisitionId)[0]?.total ?? 0);
      this.exec(`UPDATE outbox SET committed = 1, committed_at = ? WHERE acquisition_id = ?`, at, acquisitionId);
      this.exec(
        `UPDATE acquisitions SET status = ?, completed_at = ?, observed_at = ?, event_time = ?, source_published_at = ?, completeness = ?, normalizer_json = ?, quality_json = ?, rows = ?, revisions = ?, history_rows = ?, error = NULL WHERE id = ?`,
        status,
        at,
        memo.observedAt,
        input.eventTime ?? null,
        input.sourcePublishedAt ?? null,
        input.completeness,
        JSON.stringify(input.normalizer),
        JSON.stringify(input.quality),
        input.rows,
        input.revisions,
        historyRows,
        acquisitionId,
      );
      const runtime = this.runtime();
      const next: RunnerState = { ...runtime, consecutiveFailures: 0, consecutiveInterruptions: 0 };
      delete next.runningAcquisitionId;
      delete next.watchdogAt;
      if (history) {
        this.advanceBackfill(input);
      } else {
        next.checkpoint = input.checkpoint;
        next.lastSuccessAt = at;
        if (input.sourceUrl) next.sourceUrl = input.sourceUrl;
        next.cooldowns = 0;
        next.nextRunAt = new Date(now + policy.collection.cadenceSeconds * 1000).toISOString();
      }
      this.setRuntime(next);
      if (!history) this.maybeStartBackfill();
      const publish = input.products.filter((product) => product.changed).map((product) => product.productKey);
      if (!history && (publish.length > 0 || this.retiredSinceLastPublication()))
        this.setState("publication", { acquisitionId, productKeys: publish } satisfies PendingPublication);
      else this.exec(`DELETE FROM stage WHERE acquisition_id = ?`, acquisitionId);
      this.deleteState(collectionKey(acquisitionId));
    });
    try {
      await this.publishPending();
    } catch (error) {
      console.warn(JSON.stringify({ event: "publication_deferred", acquisitionId, error: String(error) }));
    }
    return { status, historyRows, outbox: this.pendingOutbox(COMMIT_OUTBOX_BLOBS) };
  }

  /** The source said nothing changed, or no product changed: advance the checkpoint only. */
  unchanged(acquisitionId: string, checkpoint: SourceCheckpoint): void {
    const acquisition = this.getAcquisition(acquisitionId);
    if (!acquisition || acquisition.status === "succeeded" || acquisition.status === "unchanged") return;
    const policy = this.requirePolicy();
    const now = this.deps.now();
    const at = new Date(now).toISOString();
    this.transaction(() => {
      this.discard(acquisitionId);
      this.exec(`UPDATE acquisitions SET status = 'unchanged', completed_at = ?, observed_at = COALESCE(observed_at, ?), error = NULL WHERE id = ?`, at, at, acquisitionId);
      const runtime = this.runtime();
      const next: RunnerState = {
        ...runtime,
        checkpoint,
        lastSuccessAt: at,
        consecutiveFailures: 0,
        consecutiveInterruptions: 0,
        cooldowns: 0,
        nextRunAt: new Date(now + policy.collection.cadenceSeconds * 1000).toISOString(),
      };
      delete next.runningAcquisitionId;
      delete next.watchdogAt;
      this.setRuntime(next);
      this.maybeStartBackfill();
      this.deleteState(collectionKey(acquisitionId));
    });
  }

  /** History walk reached the source's beginning. */
  historyExhausted(acquisitionId: string): void {
    const now = new Date(this.deps.now()).toISOString();
    this.transaction(() => {
      this.discard(acquisitionId);
      this.exec(`UPDATE acquisitions SET status = 'unchanged', completed_at = ?, error = NULL WHERE id = ?`, now, acquisitionId);
      const backfill = this.getState<BackfillState>("backfill");
      if (backfill) this.setState("backfill", { ...backfill, status: "complete", updatedAt: now });
      const runtime = this.runtime();
      const next = { ...runtime };
      delete next.runningAcquisitionId;
      delete next.watchdogAt;
      this.setRuntime(next);
      this.deleteState(collectionKey(acquisitionId));
    });
  }

  fail(acquisitionId: string, failure: CollectionFailure): void {
    const acquisition = this.getAcquisition(acquisitionId);
    if (!acquisition || acquisition.status === "succeeded" || acquisition.status === "unchanged") return;
    // Only the running attempt can fail: a repeated report, or one from an executor the watchdog already gave up on, changes nothing.
    if (this.runtime().runningAcquisitionId !== acquisitionId) return;
    const policy = this.requirePolicy();
    const now = this.deps.now();
    const at = new Date(now).toISOString();
    const message = failure.message.slice(0, 2000);
    const permanent = !failure.retryable || isPermanentCollectionError(new Error(failure.message));
    this.transaction(() => {
      this.discard(acquisitionId);
      this.exec(`UPDATE acquisitions SET status = 'failed', completed_at = ?, error = ? WHERE id = ?`, at, message, acquisitionId);
      const runtime = this.runtime();
      const next: RunnerState = { ...runtime };
      delete next.runningAcquisitionId;
      delete next.watchdogAt;
      if (acquisition.trigger === "history") {
        const backfill = this.getState<BackfillState & { nextAt?: string }>("backfill");
        if (backfill) {
          const failures = backfill.failures + 1;
          // A permanent failure ends the walk; repeated transient ones pause it until BACKFILL_RESUME_MS has passed.
          let status: BackfillState["status"] = "running";
          if (permanent) status = "failed";
          else if (failures >= BACKFILL_MAX_FAILURES) status = "paused";
          this.setState("backfill", { ...backfill, failures, lastError: message, updatedAt: at, status, nextAt: new Date(now + 120_000 * failures).toISOString() });
        }
        this.setRuntime(next);
        return;
      }
      next.consecutiveInterruptions = failure.interrupted ? runtime.consecutiveInterruptions + 1 : 0;
      if (permanent || next.consecutiveInterruptions >= INTERRUPTIONS_BEFORE_COOLDOWN) {
        // No operator: wait, then retry the same acquisition. Each repeat doubles the wait, so a broken feed costs a few runs a day at most.
        const cooldowns = (runtime.cooldowns ?? 0) + 1;
        const until = new Date(now + Math.min(COOLDOWN_MAX_MS, COOLDOWN_BASE_MS * 2 ** (cooldowns - 1))).toISOString();
        next.cooldowns = cooldowns;
        next.cooldownUntil = until;
        next.cooldownAcquisitionId = acquisitionId;
        next.consecutiveFailures = runtime.consecutiveFailures + 1;
        const reason = permanent ? message : `Collection was interrupted ${next.consecutiveInterruptions} times in a row (usually the memory or CPU limit). Last error: ${message}`;
        this.exec(`UPDATE acquisitions SET error = ? WHERE id = ?`, `${reason} Retrying automatically after ${until}.`.slice(0, 2000), acquisitionId);
        this.setRuntime(next);
        return;
      }
      const failures = runtime.consecutiveFailures + 1;
      next.consecutiveFailures = failures;
      const exponential = Math.min(MAX_RETRY_BACKOFF_SECONDS, 60 * 2 ** Math.min(failures, 6));
      const backoff = failure.retryAfterSeconds === undefined ? exponential : Math.max(exponential, Math.min(MAX_RETRY_BACKOFF_SECONDS, failure.retryAfterSeconds));
      next.nextRunAt = new Date(now + (failures <= RETRY_LIMIT ? backoff : policy.collection.cadenceSeconds) * 1000).toISOString();
      this.setRuntime(next);
    });
  }

  /**
   * Finish what a commit started: rebuild the changed chunks of large products
   * from their index, and select every current product in the Registry at once.
   * Safe to repeat.
   */
  async publishPending(): Promise<void> {
    const publication = this.getState<PendingPublication>("publication");
    if (!publication) return;
    const feed = this.requireFeed();
    const products = this.productPlans();
    for (const product of products) {
      if (product.regenerate) product.entry = await this.regenerate(feed, product, publication.acquisitionId);
    }
    const known = await this.deps.publish(products.map((product) => product.entry));
    if (!known) throw new Error("Feed is no longer registered");
    this.transaction(() => {
      this.exec(`DELETE FROM stage WHERE acquisition_id = ?`, publication.acquisitionId);
      this.deleteState("publication");
      this.deleteState("retired-products");
    });
    // A failed product keeps its index, so the next collection rebuilds from it instead of staging every row again.
    for (const product of products) {
      if (product.mode === "large" && product.entry.status !== "failed" && product.entry.rowCount < SMALL_PRODUCT_ROWS / 2) this.demote(product.productKey);
    }
  }

  /* ---------- History outbox ---------- */

  /** Committed history blobs, oldest first. */
  pendingOutbox(limit: number): OutboxBlob[] {
    const rows = this.rows<{ seq: number; lake_table: string; rows_json: string }>(`SELECT seq, lake_table, rows_json FROM outbox WHERE committed = 1 ORDER BY seq LIMIT ?`, limit);
    return rows.map((row) => {
      // SAFETY: lake_table is written only from the LakeTable union by appendOutbox/appendLakeRows.
      const table = row.lake_table as LakeTable;
      return { seq: row.seq, table, rowsJson: row.rows_json };
    });
  }

  ackOutbox(seqs: number[]): void {
    if (seqs.length === 0) return;
    this.exec(`DELETE FROM outbox WHERE seq IN (SELECT value FROM json_each(?))`, JSON.stringify(seqs));
  }

  /** Whether history committed before `before` is still waiting: the executor that committed it did not deliver it. */
  hasUndeliveredHistory(before: string): boolean {
    return this.rows<{ found: number }>(`SELECT 1 AS found FROM outbox WHERE committed = 1 AND committed_at < ? LIMIT 1`, before).length > 0;
  }

  committedOutboxRows(): number {
    return Number(this.rows<{ total: number | null }>(`SELECT SUM(rows) AS total FROM outbox WHERE committed = 1`)[0]?.total ?? 0);
  }

  /** Undelivered history in UTF-8 bytes: what the backlog budget and `historyBacklog` measure. */
  committedOutboxBytes(): number {
    return Number(this.rows<{ total: number | null }>(`SELECT SUM(bytes) AS total FROM outbox WHERE committed = 1`)[0]?.total ?? 0);
  }

  /* ---------- Backfill ---------- */

  backfillSummary(): BackfillSummary | undefined {
    const state = this.getState<BackfillState>("backfill");
    if (!state) return undefined;
    const summary: BackfillSummary = {
      status: state.status,
      cursor: state.cursor.before,
      slices: state.slices,
      points: state.points,
      records: state.records,
      failures: state.failures,
      floors: state.floors,
      startedAt: state.startedAt,
      updatedAt: state.updatedAt,
    };
    if (state.until) summary.until = state.until;
    if (state.lastError) summary.lastError = state.lastError;
    return summary;
  }

  /** Oldest event time this feed serves today; where a history walk starts by default. */
  oldestServedTime(): string | undefined {
    const times = this.productPlans()
      .map((product) => product.entry.watermark)
      .filter((value): value is string => Boolean(value));
    return times.sort()[0];
  }

  /* ---------- Reads ---------- */

  status(): FeedStatus {
    const runtime = this.runtime();
    const last = this.listAcquisitions(1)[0];
    const status: FeedStatus = { consecutiveFailures: runtime.consecutiveFailures, running: Boolean(runtime.runningAcquisitionId) };
    if (runtime.checkpoint) status.checkpoint = runtime.checkpoint;
    if (runtime.nextRunAt) status.nextRunAt = runtime.nextRunAt;
    if (runtime.lastAttemptAt) status.lastAttemptAt = runtime.lastAttemptAt;
    if (runtime.lastSuccessAt) status.lastSuccessAt = runtime.lastSuccessAt;
    if (runtime.sourceUrl) status.sourceUrl = runtime.sourceUrl;
    if (last) status.lastAcquisitionStatus = last.status;
    if (last?.error) status.lastError = last.error;
    if (runtime.cooldownUntil) {
      status.cooldownUntil = runtime.cooldownUntil;
      status.lastAcquisitionStatus = "failed";
      const failed = runtime.cooldownAcquisitionId ? this.getAcquisition(runtime.cooldownAcquisitionId) : undefined;
      status.lastError = failed?.error ?? `Collection failed; retrying automatically after ${runtime.cooldownUntil}.`;
    }
    const backfill = this.backfillSummary();
    if (backfill) status.backfill = backfill;
    const backlog = this.committedOutboxBytes();
    if (backlog > 0) status.historyBacklog = backlog;
    return status;
  }

  getAcquisition(id: string): Acquisition | undefined {
    const row = this.rows<AcquisitionRow>(`SELECT * FROM acquisitions WHERE id = ?`, id)[0];
    return row ? mapAcquisition(row, this.feed()?.id ?? "") : undefined;
  }

  listAcquisitions(limit: number): Acquisition[] {
    const feedId = this.feed()?.id ?? "";
    return this.rows<AcquisitionRow>(`SELECT * FROM acquisitions ORDER BY requested_at DESC LIMIT ?`, limit).map((row) => mapAcquisition(row, feedId));
  }

  productPlans(): ProductPlan[] {
    return this.rows<ProductRow>(`SELECT product_key, slug, mode, entry_json, regenerate FROM products ORDER BY product_key`).map((row) => ({
      productKey: row.product_key,
      slug: row.slug,
      // SAFETY: mode is written only from the "small" | "large" union.
      mode: row.mode as "small" | "large",
      // SAFETY: entry_json is written only from a ProductIndexEntry by saveProduct/regenerate.
      entry: JSON.parse(row.entry_json) as ProductIndexEntry,
      regenerate: row.regenerate === 1,
    }));
  }

  /* ---------- Maintenance ---------- */

  /** Delete the serving objects whose grace period has passed; `nextAlarm` wakes the runner for them. */
  async collectGarbage(): Promise<number> {
    const now = new Date(this.deps.now()).toISOString();
    const due = this.rows<{ object_key: string }>(`SELECT object_key FROM garbage WHERE delete_after <= ? ORDER BY delete_after LIMIT 1000`, now).map((row) => row.object_key);
    if (due.length === 0) return 0;
    await this.deps.objects.delete(due);
    this.exec(`DELETE FROM garbage WHERE object_key IN (SELECT value FROM json_each(?))`, JSON.stringify(due));
    return due.length;
  }

  /** Bound the bookkeeping when an acquisition ends: the newest acquisitions, and nothing an executor left behind without reporting. */
  prune(): void {
    const runtime = this.runtime();
    this.exec(
      `DELETE FROM acquisitions WHERE id IN (SELECT id FROM acquisitions ORDER BY requested_at DESC LIMIT -1 OFFSET 500) AND status NOT IN ('queued', 'running') AND id IS NOT ?`,
      runtime.cooldownAcquisitionId ?? null,
    );
    const running = runtime.runningAcquisitionId ?? "";
    this.exec(`DELETE FROM outbox WHERE committed = 0 AND acquisition_id != ?`, running);
    const publishing = this.getState<PendingPublication>("publication")?.acquisitionId ?? "";
    this.exec(`DELETE FROM stage WHERE acquisition_id != ? AND acquisition_id != ?`, running, publishing);
  }

  /** A retired feed keeps nothing except history not yet delivered. */
  canRetire(): boolean {
    return this.committedOutboxRows() === 0;
  }

  /* ---------- Internals ---------- */

  private createAcquisition(trigger: string, policyVersion: number): Acquisition {
    const id = `acq_${crypto.randomUUID()}`;
    this.insertAcquisition(id, trigger, policyVersion);
    return this.getAcquisition(id)!;
  }

  private insertAcquisition(id: string, trigger: string, policyVersion: number): void {
    this.exec(
      `INSERT INTO acquisitions (id, trigger, status, requested_at, policy_version) VALUES (?, ?, 'queued', ?, ?)`,
      id,
      trigger,
      new Date(this.deps.now()).toISOString(),
      policyVersion,
    );
  }

  private nextQueued(): Acquisition | undefined {
    const row = this.rows<AcquisitionRow>(`SELECT * FROM acquisitions WHERE status = 'queued' AND trigger != 'history' ORDER BY requested_at LIMIT 1`)[0];
    return row ? mapAcquisition(row, this.feed()?.id ?? "") : undefined;
  }

  private memo(acquisitionId: string): CollectionMemo {
    const memo = this.getState<CollectionMemo>(collectionKey(acquisitionId));
    if (!memo) throw new Error(`Acquisition ${acquisitionId} has not begun`);
    return memo;
  }

  private recordContext(acquisitionId: string, productKey: string): RecordContext {
    const memo = this.memo(acquisitionId);
    const declared = memo.declared?.find((product) => product.productKey === productKey);
    if (!declared || !memo.normalizer) throw new NormalizedInputError(`Product ${productKey} was not declared`);
    const policy = this.requirePolicy();
    const context: RecordContext = {
      feedId: this.requireFeed().id,
      acquisitionId,
      slug: declared.slug,
      productVersion: declared.version,
      observedAt: memo.observedAt,
      normalizer: memo.normalizer,
      baseline: declared.baseline,
      keepHistory: memo.lake && keepsHistory(policy, productKey),
    };
    if (memo.sourcePublishedAt) context.sourcePublishedAt = memo.sourcePublishedAt;
    return context;
  }

  private lookup(productKey: string, entityKeys: string[]): Map<string, { id: number; hash: string }> {
    const found = new Map<string, { id: number; hash: string }>();
    for (let start = 0; start < entityKeys.length; start += LOOKUP_BATCH) {
      const slice = entityKeys.slice(start, start + LOOKUP_BATCH);
      for (const row of this.rows<{ id: number; entity_key: string; hash: string }>(
        `SELECT id, entity_key, hash FROM entities WHERE product_key = ? AND entity_key IN (SELECT value FROM json_each(?))`,
        productKey,
        JSON.stringify(slice),
      )) {
        found.set(row.entity_key, { id: row.id, hash: row.hash });
      }
    }
    return found;
  }

  /** History rows as outbox blobs within the SQLite value budget. */
  private appendLakeRows(acquisitionId: string, table: LakeTable, rows: JsonObject[]): void {
    for (const blob of jsonArrays(rows.map((row) => JSON.stringify(row)))) {
      this.exec(`INSERT INTO outbox (acquisition_id, lake_table, rows_json, rows, bytes) VALUES (?, ?, ?, ?, ?)`, acquisitionId, table, blob.json, blob.count, blob.bytes);
    }
  }

  /** Staged entity changes as blobs within the SQLite value budget; applyStage reads them back in order. */
  private insertStage(acquisitionId: string, productKey: string, staged: Array<[string, string | null, string | null]>): void {
    for (const blob of jsonArrays(staged.map((item) => JSON.stringify(item)))) {
      this.exec(`INSERT INTO stage (acquisition_id, product_key, body) VALUES (?, ?, ?)`, acquisitionId, productKey, blob.json);
    }
  }

  /**
   * Apply staged blobs in order, one set-based statement per blob and kind:
   * SQLite parses the JSON itself, so neither the blobs nor their rows are
   * ever held in JavaScript memory at once. Within one blob a key occurs once.
   */
  private applyStage(acquisitionId: string, productKey: string): void {
    for (const { seq } of this.rows<{ seq: number }>(`SELECT seq FROM stage WHERE acquisition_id = ? AND product_key = ? ORDER BY seq`, acquisitionId, productKey)) {
      this.exec(
        `INSERT INTO entities (product_key, entity_key, hash, row_json)
         SELECT ?, json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]'), json_extract(j.value, '$[2]')
         FROM stage s, json_each(s.body) j WHERE s.seq = ? AND json_extract(j.value, '$[1]') IS NOT NULL
         ON CONFLICT(product_key, entity_key) DO UPDATE SET hash = excluded.hash, row_json = excluded.row_json`,
        productKey,
        seq,
      );
      this.exec(
        `DELETE FROM entities WHERE product_key = ? AND entity_key IN
         (SELECT json_extract(j.value, '$[0]') FROM stage s, json_each(s.body) j WHERE s.seq = ? AND json_extract(j.value, '$[1]') IS NULL)`,
        productKey,
        seq,
      );
    }
  }

  /** The entity keys one staged blob touches. */
  private stagedKeys(seq: number): string[] {
    return this.rows<{ key: string }>(`SELECT json_extract(j.value, '$[0]') AS key FROM stage s, json_each(s.body) j WHERE s.seq = ?`, seq).map((row) => row.key);
  }

  private saveProduct(product: ProductCommit, history: boolean): void {
    // History slices never change current serving: their slugs were claimed at declaration.
    if (history) return;
    const current = this.rows<{ entry_json: string }>(`SELECT entry_json FROM products WHERE product_key = ?`, product.productKey)[0];
    if (!product.changed && current) return;
    const mode = product.mode === "large" ? "large" : "small";
    this.exec(
      `INSERT INTO products (product_key, slug, mode, entry_json, regenerate) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(product_key) DO UPDATE SET mode = excluded.mode, entry_json = excluded.entry_json, regenerate = excluded.regenerate`,
      product.productKey,
      product.entry.slug,
      mode,
      JSON.stringify(product.entry),
      product.mode === "large" && product.staged ? 1 : 0,
    );
    // SAFETY: entry_json is written only from ProductIndexEntry values.
    this.supersede(current ? (JSON.parse(current.entry_json) as ProductIndexEntry) : null, product.entry);
  }

  /**
   * Only the selected version is served, so what the previous entry referenced
   * and the next one does not is garbage. What the next one references is not,
   * even if an earlier version discarded it: content-addressed chunks come back.
   */
  private supersede(previous: ProductIndexEntry | null, next: ProductIndexEntry): void {
    const kept = objectKeysOf(next);
    this.exec(`DELETE FROM garbage WHERE object_key IN (SELECT value FROM json_each(?))`, JSON.stringify(kept));
    if (!previous) return;
    const keep = new Set(kept);
    this.discardObjects(objectKeysOf(previous).filter((key) => !keep.has(key)));
  }

  /** Serving objects no product version selects any more: deleted once their grace period has passed. */
  private discardObjects(objectKeys: Iterable<string>): void {
    const deleteAfter = new Date(this.deps.now() + GARBAGE_GRACE_MS).toISOString();
    for (const key of objectKeys) this.exec(`INSERT INTO garbage (object_key, delete_after) VALUES (?, ?) ON CONFLICT(object_key) DO NOTHING`, key, deleteAfter);
  }

  private retireMissing(productKeys: string[]): void {
    const keep = new Set(productKeys);
    const missing = this.rows<{ product_key: string }>(`SELECT product_key FROM products`)
      .map((row) => row.product_key)
      .filter((key) => !keep.has(key));
    if (missing.length === 0) return;
    for (const key of missing) {
      // A retired product's serving objects are no longer selectable once the Registry publishes without it.
      this.discardObjects(this.productObjectKeys(key));
      this.exec(`DELETE FROM entities WHERE product_key = ?`, key);
      this.exec(`DELETE FROM products WHERE product_key = ?`, key);
    }
    this.setState("retired-products", missing);
  }

  private retiredSinceLastPublication(): boolean {
    return (this.getState<string[]>("retired-products")?.length ?? 0) > 0;
  }

  /** Rebuild the chunks a large product's committed changes touched; returns the entry to publish. */
  private async regenerate(feed: Feed, product: ProductPlan, acquisitionId: string): Promise<ProductIndexEntry> {
    const previous = product.entry.chunks ?? [];
    const dirty = previous.map(() => false);
    if (previous.length > 0) {
      for (const { seq } of this.rows<{ seq: number }>(`SELECT seq FROM stage WHERE acquisition_id = ? AND product_key = ?`, acquisitionId, product.productKey)) {
        for (const key of this.stagedKeys(seq)) dirty[chunkIndexFor(previous, key)] = true;
      }
    }
    const sink: ChunkSink = {
      prefix: keys.prefix(feed.id, product.slug),
      known: new Set(previous.map((chunk) => chunk.key)),
      put: async (key, body) => {
        await this.deps.objects.writeText(key, body);
      },
    };
    const chunks = await regenerateChunks(
      previous,
      dirty,
      (after, limit) => {
        const rows =
          after === null
            ? this.rows<{ entity_key: string; row_json: string }>(
                `SELECT entity_key, row_json FROM entities WHERE product_key = ? ORDER BY entity_key LIMIT ?`,
                product.productKey,
                limit,
              )
            : this.rows<{ entity_key: string; row_json: string }>(
                `SELECT entity_key, row_json FROM entities WHERE product_key = ? AND entity_key > ? ORDER BY entity_key LIMIT ?`,
                product.productKey,
                after,
                limit,
              );
        return rows.map((row) => ({ key: row.entity_key, json: row.row_json }));
      },
      sink,
    );
    const problem = chunkListProblem(chunks, product.slug);
    // The commit is durable, so a product too large to list must not wedge publication: it serves nothing, and every collection tries again.
    if (problem) console.error(JSON.stringify({ event: "chunk_list_too_large", feedId: feed.id, problem }));
    const entry: ProductIndexEntry = problem
      ? { ...product.entry, status: "failed", chunks: null, rowCount: 0 }
      : { ...product.entry, chunks, rowCount: chunks.reduce((sum, chunk) => sum + chunk.rows, 0) };
    this.transaction(() => {
      if (problem) this.discardObjects(chunks.map((chunk) => chunk.key));
      this.supersede(product.entry, entry);
      this.exec(`UPDATE products SET entry_json = ?, regenerate = 0 WHERE product_key = ?`, JSON.stringify(entry), product.productKey);
    });
    return entry;
  }

  private demote(productKey: string): void {
    this.transaction(() => {
      this.exec(`DELETE FROM entities WHERE product_key = ?`, productKey);
      this.exec(`UPDATE products SET mode = 'small' WHERE product_key = ?`, productKey);
    });
  }

  private advanceBackfill(input: CommitInput): void {
    const backfill = this.getState<BackfillState & { nextAt?: string }>("backfill");
    if (!backfill || !input.history) return;
    const history = input.history;
    const seen = { ...history.seen };
    const seenKeys = Object.keys(seen);
    for (const key of seenKeys.slice(0, Math.max(0, seenKeys.length - MAX_SEEN))) delete seen[key];
    const exhausted = history.exhausted || (backfill.until !== undefined && history.nextCursor !== undefined && history.nextCursor.before <= backfill.until);
    const now = this.deps.now();
    const next: BackfillState & { nextAt?: string } = {
      ...backfill,
      status: exhausted ? "complete" : "running",
      cursor: history.nextCursor ?? backfill.cursor,
      visitedCursors: [...backfill.visitedCursors, historyCursorKey(backfill.cursor)].slice(-256),
      floors: history.floors,
      seen,
      slices: backfill.slices + 1,
      points: backfill.points + history.points,
      records: backfill.records + history.records,
      failures: 0,
      updatedAt: new Date(now).toISOString(),
      // Pace per source: several feeds of one Gatekeeper share one polite rate.
      nextAt: new Date(now + Math.max(20_000, 6_000 * this.backfillPeers)).toISOString(),
    };
    delete next.lastError;
    this.setState("backfill", next);
  }

  /**
   * The first successful live collection of a feed whose source offers history
   * starts its one history walk, a little later, back to the source's stated
   * beginning or BACKFILL_MAX_YEARS, whichever is more recent. It is never
   * started twice; it stops by itself when the source says it is exhausted.
   */
  private maybeStartBackfill(): void {
    const history = this.feed()?.resolved.history;
    if (!history || !this.deps.lakeAvailable || this.getState<BackfillState>("backfill")) return;
    // A policy that keeps no history walks none either.
    if (this.policy()?.collection.historyMode !== "changes") return;
    const now = this.deps.now();
    const at = new Date(now).toISOString();
    const floor = new Date(now);
    floor.setUTCFullYear(floor.getUTCFullYear() - BACKFILL_MAX_YEARS);
    const earliest = history.earliest ? Date.parse(history.earliest) : Number.NaN;
    const until = new Date(Number.isFinite(earliest) ? Math.max(earliest, floor.getTime()) : floor.getTime()).toISOString();
    const walk: BackfillState & { nextAt: string } = {
      status: "running",
      cursor: { before: this.oldestServedTime() ?? at },
      visitedCursors: [],
      walkId: crypto.randomUUID(),
      until,
      floors: {},
      seen: {},
      slices: 0,
      points: 0,
      records: 0,
      failures: 0,
      startedAt: at,
      updatedAt: at,
      nextAt: new Date(now + BACKFILL_START_DELAY_MS).toISOString(),
    };
    this.setState("backfill", walk);
  }

  /** When a stalled walk tries again by itself; undefined while it runs or once it is complete. */
  private backfillResumeAt(state: BackfillState): number | undefined {
    if (state.status === "paused") return Date.parse(state.updatedAt) + BACKFILL_RESUME_MS;
    if (state.status === "failed") return Date.parse(state.updatedAt) + BACKFILL_RETRY_FAILED_MS;
    return undefined;
  }

  /** Remove everything an unfinished attempt of this acquisition wrote. */
  private discard(acquisitionId: string): void {
    this.exec(`DELETE FROM stage WHERE acquisition_id = ?`, acquisitionId);
    this.exec(`DELETE FROM outbox WHERE acquisition_id = ? AND committed = 0`, acquisitionId);
  }

  private tableExists(name: string): boolean {
    return this.rows<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`, name).length > 0;
  }

  private exec(query: string, ...bindings: SqlStorageValue[]): void {
    this.sql.exec(query, ...bindings);
  }

  private rows<T extends Record<string, SqlStorageValue>>(query: string, ...bindings: SqlStorageValue[]): T[] {
    return this.sql.exec<T>(query, ...bindings).toArray();
  }
}

/** One acquisitions row as the API and the Registry mirror see it; the feed is read once per list, not once per row. */
function mapAcquisition(row: AcquisitionRow, feedId: string): Acquisition {
  const acquisition: Acquisition = {
    id: row.id,
    feedId,
    trigger: row.trigger,
    // SAFETY: status is written only from the AcquisitionStatus union.
    status: row.status as AcquisitionStatus,
    requestedAt: row.requested_at,
    policyVersion: row.policy_version,
  };
  if (row.started_at) acquisition.startedAt = row.started_at;
  if (row.completed_at) acquisition.completedAt = row.completed_at;
  if (row.observed_at) acquisition.observedAt = row.observed_at;
  if (row.event_time) acquisition.eventTime = row.event_time;
  if (row.source_published_at) acquisition.sourcePublishedAt = row.source_published_at;
  if (row.completeness) {
    // SAFETY: completeness is written only from the Completeness union.
    acquisition.completeness = row.completeness as Completeness;
  }
  if (row.normalizer_json) {
    // SAFETY: normalizer_json is written only from a normalizer identity.
    acquisition.normalizer = JSON.parse(row.normalizer_json) as { id: string; version: string };
  }
  if (row.quality_json) {
    // SAFETY: quality_json is written only from the TransformQuality a batch completed with.
    acquisition.quality = JSON.parse(row.quality_json) as TransformQuality;
  }
  if (row.rows !== null) acquisition.rows = row.rows;
  if (row.revisions !== null) acquisition.revisions = row.revisions;
  if (row.history_rows !== null) acquisition.historyRows = row.history_rows;
  if (row.error) acquisition.error = row.error;
  return acquisition;
}

interface CollectionMemo {
  observedAt: string;
  lake: boolean;
  normalizer?: { id: string; version: string };
  sourcePublishedAt?: string;
  declared?: Array<{ productKey: string; slug: string; version: number; baseline: boolean }>;
}

interface PendingPublication {
  acquisitionId: string;
  productKeys: string[];
}

interface AcquisitionRow extends Record<string, SqlStorageValue> {
  id: string;
  trigger: string;
  status: string;
  requested_at: string;
  started_at: string | null;
  completed_at: string | null;
  observed_at: string | null;
  event_time: string | null;
  source_published_at: string | null;
  completeness: string | null;
  normalizer_json: string | null;
  quality_json: string | null;
  rows: number | null;
  revisions: number | null;
  history_rows: number | null;
  policy_version: number;
  error: string | null;
}

interface ProductRow extends Record<string, SqlStorageValue> {
  product_key: string;
  slug: string;
  mode: string;
  entry_json: string;
  regenerate: number;
}

/**
 * Bind a batch's products to durable slugs and the versions they would
 * publish: a product the feed already serves keeps its slug and mode; a new
 * one starts as a baseline under its suggested slug. The runner and the
 * executor compute the same answer from the same product plans.
 */
export function declareProducts(existing: ProductPlan[], headers: NormalizedProductHeader[]): DeclaredProduct[] {
  const byKey = new Map(existing.map((product) => [product.productKey, product]));
  const declared = headers.map((header): DeclaredProduct => {
    const previous = byKey.get(header.productKey);
    if (previous) {
      return {
        productKey: header.productKey,
        slug: previous.slug,
        kind: header.kind,
        version: previous.entry.version + 1,
        baseline: false,
        mode: previous.mode,
        previous: previous.entry,
      };
    }
    return {
      productKey: header.productKey,
      slug: header.suggestedSlug,
      kind: header.kind,
      version: 1,
      baseline: true,
      mode: header.kind === "record" ? "large" : "small",
      previous: null,
    };
  });
  const slugs = declared.map((product) => product.slug);
  if (new Set(slugs).size !== slugs.length) throw new NormalizedInputError("Two products of one batch map to the same slug");
  return declared;
}

/** Every serving object an entry references: its chunks and its windows. */
function objectKeysOf(entry: ProductIndexEntry): string[] {
  const found = (entry.chunks ?? []).map((chunk) => chunk.key);
  for (const key of [entry.changesKey, entry.seriesKey, entry.seriesChangesKey]) if (key) found.push(key);
  return found;
}

function collectionKey(acquisitionId: string): string {
  return `collection:${acquisitionId}`;
}

export function backfillAcquisitionId(feedId: string, state: Pick<BackfillState, "walkId" | "cursor">): string {
  return `hist_${digest(`${feedId}|${state.walkId}|${JSON.stringify(state.cursor)}`)}`;
}

function rowHash(json: string): string {
  return servedIdentity(json).hash;
}
