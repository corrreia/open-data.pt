import { DurableObject } from "cloudflare:workers";
import { NormalizedInputError, assertResolvedFeed, hashSourceConfig, type ExampleFeed, type SourceCheckpoint, type SourceConfig } from "@open-data-pt/gatekeeper-shared";

import { drainOutbox } from "./engine";
import { NotFoundError } from "./errors";
import { syncStep, type CatalogEntry, type SyncPorts, type SyncProgress, type SyncState } from "./example-sync";
import type { ManifestChunk } from "./chunks";
import { definitionFingerprint, keepsHistory, policyFingerprint, type Acquisition, type Feed, type FeedPolicy, type ProductIndexEntry, type ProductSummary } from "./feed-model";
import { buildGatekeeperRegistry, getFeedGatekeeper } from "./gatekeeper-registry";
import { digest } from "./hash";
import { PipelinesLake, lakeStreams, type LakeTable } from "./lake";
import { ObjectStore } from "./object-store";
import { runLakeQuery } from "./query";
import { SUMMARY_DAYS_PER_WAKE, SUMMARY_DUE_STATE_KEY, summariseSettledDays } from "./summaries";
import { R2SnapshotStore } from "./r2-snapshot-store";
import { RegistryStore } from "./registry-store";
import type { ActivityWindow } from "./registry-store";
import {
  RunnerCore,
  type BeginResult,
  type CollectionFailure,
  type CommitInput,
  type CommitResult,
  type DeclaredProduct,
  type DeclareInput,
  type OutboxBlob,
  type StagedRecord,
  type StageResult,
  type SweepResult,
} from "./runner-core";
import { ingestRunnerReport, OUTAGE_KEEP_MS, OUTAGES_SINCE_KEY, type OutageWindow, type RunnerReport, type RunnerReportReceipt, isSustained } from "./runner-reporting";

export type { RunnerReport, RunnerReportReceipt } from "./runner-reporting";
export type { SyncProgress } from "./example-sync";

/** Coordinated names: one registry, one runner per feed. */
export const REGISTRY_ROOM = "main";

const SYNC_STATE_KEY = "example-sync";
const AUDIT_DUE_KEY = "lake-audit-due";
/** History its Workflow has not delivered after this long is drained by the runner's alarm. */
const LEFTOVER_HISTORY_AFTER_MS = 10 * 60_000;
/** An alarm pays Durable Object duration while it waits on Pipelines, so it sends a bounded share; the next wake-up sends the rest. */
const LEFTOVER_ALARM_BLOBS = 40;

/** One Gatekeeper example, as the Registry turns it into a feed. */
interface FeedInput {
  slug: string;
  title: string;
  description: string;
  gatekeeperKind: string;
  config: SourceConfig;
  policyId: string;
  staleAfterSeconds: number;
  publisher?: string;
  topics: string[];
}

/**
 * A product as the public API lists it: the selected entry without its chunk
 * list, and what its feed and current policy say about it, computed at read time.
 */
export interface ProductView extends ProductSummary {
  stale: boolean;
  /** This product's history is kept and served: its policy keeps history and does not leave this product out. */
  exposeHistory: boolean;
  /** `changes` when this product keeps history, `latest` when it serves current state only. */
  historyMode: "changes" | "latest";
  licence: string | null;
  attribution: string | null;
  staleAfterSeconds: number;
  cadenceSeconds: number;
}

/** One product as the API reads it: the view plus the chunks its records are served from. */
export interface ProductDetail extends ProductView {
  chunks: ManifestChunk[] | null;
}

export interface LakeAudit {
  at: string;
  window: { from: string; to: string };
  checked: number;
  mismatches: Array<{ acquisitionId: string; feedId: string; expected: number; found: number }>;
  error?: string;
}

function registry(env: Env): DurableObjectStub<Registry> {
  return env.Registry.getByName(REGISTRY_ROOM);
}

/**
 * The Registry: feed definitions and policies, a mirror of runner status and
 * recent acquisitions, slug ownership, and the product index the public API
 * reads. Nobody administers it. Its alarm keeps the feeds equal to the
 * examples every Gatekeeper lists (installing, updating and retiring them,
 * see example-sync.ts) and runs the daily lake delivery audit. Product
 * staleness is computed when products are read.
 */
export class Registry extends DurableObject<Env> {
  private readonly store: RegistryStore;
  private activeHistoryQueries = 0;
  private reportsSincePrune = 0;
  /** The sync step in flight: its RPC round trips let other events in, and two steps must never interleave. */
  private syncing: Promise<SyncProgress> | undefined;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.store = new RegistryStore(ctx.storage.sql);
    this.store.migrate();
    // Only the alarm starts work: a fresh or reset Registry installs every example on its first one.
    void ctx.blockConcurrencyWhile(async () => {
      const wake = this.nextWake();
      const current = await ctx.storage.getAlarm();
      if (current === null || current > wake) await ctx.storage.setAlarm(wake);
    });
  }

  tryStartHistoryQuery(): boolean {
    if (this.activeHistoryQueries >= 4) return false;
    this.activeHistoryQueries += 1;
    return true;
  }

  finishHistoryQuery(): void {
    this.activeHistoryQueries = Math.max(0, this.activeHistoryQueries - 1);
  }

  override async alarm(): Promise<void> {
    if (this.env.CATALOG_TOKEN) await this.auditIfDue();
    let retryIn = 0;
    try {
      await this.syncExamples();
    } catch (error) {
      // Never a tight loop: a step that throws (not one whose operations fail) waits a minute.
      retryIn = 60_000;
      console.error(JSON.stringify({ event: "example_sync_failed", error: String(error) }));
    }
    // After the sync, so keeping feeds equal to the examples never waits on the lake.
    if (this.env.CATALOG_TOKEN) await this.summariseIfDue();
    await this.ctx.storage.setAlarm(Math.max(Date.now() + retryIn, this.nextWake()));
  }

  /** Now while sync operations are queued, else the next catalog check, lake audit or series summary. */
  private nextWake(): number {
    const now = Date.now();
    const sync = this.store.getState<SyncState>(SYNC_STATE_KEY);
    let wake = sync === undefined || sync.queue.length > 0 ? now : sync.nextCheckAt;
    if (this.env.CATALOG_TOKEN) {
      wake = Math.min(wake, this.store.getState<number>(AUDIT_DUE_KEY) ?? nextAuditTime(now));
      wake = Math.min(wake, this.store.getState<number>(SUMMARY_DUE_STATE_KEY) ?? nextAuditTime(now));
    }
    return wake;
  }

  /**
   * Summarises the days of every public time series that are over and
   * settled, a few per wake, into the R2 blobs the summary endpoints and
   * charts read instead of the lake. A failure waits an hour; a backlog, a minute.
   */
  private async summariseIfDue(): Promise<void> {
    const now = Date.now();
    const due = this.store.getState<number>(SUMMARY_DUE_STATE_KEY);
    if (due === undefined) {
      // A fresh or reset Registry settles first: the first run waits ten minutes rather than taking its first alarm.
      this.store.setState(SUMMARY_DUE_STATE_KEY, now + 10 * 60_000);
      return;
    }
    if (due > now) return;
    const products = new Set(
      this.listProducts()
        .filter((product) => product.role === "time-series" && product.exposeHistory)
        .map((product) => product.slug),
    );
    try {
      const run = await summariseSettledDays({ env: this.env, objects: new ObjectStore(new R2SnapshotStore(this.env.DATA_OBJECTS)), products }, now, SUMMARY_DAYS_PER_WAKE);
      this.store.setState(SUMMARY_DUE_STATE_KEY, run.backlog ? now + 60_000 : run.nextDue);
      if (run.summarised.length > 0 || run.late.length > 0 || run.backlog)
        console.log(JSON.stringify({ event: "series_summaries", days: run.summarised, lateDays: run.late, backlog: run.backlog, bytesScanned: run.bytesScanned }));
    } catch (error) {
      this.store.setState(SUMMARY_DUE_STATE_KEY, now + 3_600_000);
      console.error(JSON.stringify({ event: "series_summary_failed", error: String(error) }));
    }
  }

  private async auditIfDue(): Promise<void> {
    const now = Date.now();
    const due = this.store.getState<number>(AUDIT_DUE_KEY);
    if (due !== undefined && due > now) return;
    this.store.setState(AUDIT_DUE_KEY, nextAuditTime(now));
    if (due === undefined) return;
    try {
      await this.auditLake();
    } catch (error) {
      console.error(JSON.stringify({ event: "lake_audit_failed", error: String(error) }));
    }
  }

  /* ---------- Keeping feeds equal to the Gatekeepers' examples ---------- */

  /**
   * One sync step; the alarm calls it and runs another at once while work is
   * queued. `check` compares the catalog now instead of on schedule.
   */
  syncExamples(check = false): Promise<SyncProgress> {
    this.syncing ??= syncStep(this.syncPorts(), { check }).finally(() => {
      this.syncing = undefined;
    });
    return this.syncing;
  }

  /** The sync has compared the catalog and applied all of it; until then an unknown feed may be one it is about to install. */
  private syncSettled(): boolean {
    const sync = this.store.getState<SyncState>(SYNC_STATE_KEY);
    return sync?.lastCheckedAt !== undefined && sync.queue.length === 0;
  }

  private syncPorts(): SyncPorts {
    return {
      boundKinds: () => [...buildGatekeeperRegistry(this.env).keys()],
      readCatalog: () => this.readCatalog(),
      feeds: () => this.store.listFeeds().map((feed) => ({ id: feed.id, slug: feed.slug, gatekeeperKind: feed.gatekeeperKind })),
      apply: (kind, example) => this.applyExample(kind, example),
      retire: (feedId) => this.retireFeed(feedId),
      load: () => this.store.getState<SyncState>(SYNC_STATE_KEY),
      save: (state) => this.store.setState(SYNC_STATE_KEY, state),
      now: () => Date.now(),
    };
  }

  private async readCatalog(): Promise<CatalogEntry[]> {
    const catalog: CatalogEntry[] = [];
    for (const [kind, gatekeeper] of buildGatekeeperRegistry(this.env)) {
      try {
        const [examples, kinds] = await Promise.all([gatekeeper.exampleFeeds(), gatekeeper.listFeedKinds()]);
        catalog.push({ kind, examples, kinds });
      } catch (error) {
        console.warn(JSON.stringify({ event: "gatekeeper_unavailable", kind, error: String(error) }));
      }
    }
    return catalog;
  }

  private async applyExample(kind: string, example: ExampleFeed): Promise<void> {
    // A policy is its name and version; the id is only the row's handle. One installed under an earlier Worker's
    // name keeps its id, so moving a feed between Workers never collides with the row it already uses.
    const current = this.store.getPolicyByName(example.policy.name, example.policy.version);
    const policyId = current?.id ?? `policy_${kind}_${slugify(example.policy.name)}_v${example.policy.version}`;
    const policy: FeedPolicy = { id: policyId, ...example.policy, createdAt: current?.createdAt ?? new Date().toISOString() };
    if (!current || policyFingerprint(current) !== policyFingerprint(policy)) this.store.upsertPolicy(policy);
    const input: FeedInput = {
      slug: example.slug,
      title: example.title,
      description: example.description,
      gatekeeperKind: kind,
      config: example.config,
      policyId,
      staleAfterSeconds: example.staleAfterSeconds,
      topics: example.topics ?? [],
    };
    if (example.publisher) input.publisher = example.publisher;
    await this.installFeed(input);
  }

  /**
   * Resolve an example through its Gatekeeper and hand the definition to its
   * runner, which ignores one it already has. A known slug keeps its feed ID
   * (lake history is keyed by it); a new slug gets an ID derived from it, so a
   * reset Registry installs it under the same ID again.
   */
  private async installFeed(input: FeedInput): Promise<string> {
    const gatekeeper = getFeedGatekeeper(buildGatekeeperRegistry(this.env), input.gatekeeperKind);
    const resolved = await gatekeeper.resolveFeed(input.config);
    assertResolvedFeed(resolved);
    if (resolved.configHash !== (await hashSourceConfig(resolved.config))) throw new NormalizedInputError("Resolved feed configuration digest did not match");
    const policy = this.store.getPolicy(input.policyId);
    if (!policy) throw new NotFoundError(`Policy ${input.policyId} was not found`);
    const existing = this.store.getFeedBySlug(input.slug);
    const now = new Date().toISOString();
    const sameSemantics =
      existing?.resolved.resourceKey === resolved.resourceKey &&
      existing.resolved.kind === resolved.kind &&
      JSON.stringify(existing.resolved.semantics) === JSON.stringify(resolved.semantics) &&
      JSON.stringify(existing.resolved.history ?? null) === JSON.stringify(resolved.history ?? null);
    const candidate: Feed = {
      ...input,
      id: existing?.id ?? `feed_${digest(`feed:${input.slug}`)}`,
      config: resolved.config,
      semantics: resolved.semantics,
      resolved,
      enabled: true,
      feedEpoch: sameSemantics ? existing.feedEpoch : now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const unchanged = existing !== undefined && definitionFingerprint(existing) === definitionFingerprint(candidate);
    const feed: Feed = unchanged ? { ...candidate, updatedAt: existing.updatedAt } : candidate;
    if (!unchanged) this.store.upsertFeed(feed);
    // A runner re-sent what it already has reports nothing, unless this Registry holds no status for it (a fresh or reset Registry).
    await this.env.FeedRunner.getByName(feed.id).configure(feed, policy, existing?.consecutiveFailures === undefined);
    return feed.id;
  }

  /** The runner first stops taking work (so a failure here leaves the feed listed and the next check retries), then the feed is forgotten. */
  private async retireFeed(feedId: string): Promise<void> {
    await this.env.FeedRunner.getByName(feedId).decommission();
    this.ctx.storage.transactionSync(() => this.store.deleteFeed(feedId));
    console.warn(JSON.stringify({ event: "feed_retired", feedId }));
  }

  /* ---------- Feeds and policies ---------- */

  listFeeds(): Feed[] {
    return this.store.listFeeds();
  }

  getFeed(id: string): Feed | undefined {
    return this.store.getFeed(id);
  }

  listPolicies(): FeedPolicy[] {
    return this.store.listPolicies();
  }

  getPolicy(id: string): FeedPolicy | undefined {
    return this.store.getPolicy(id);
  }

  /* ---------- Products ---------- */

  listProducts(): ProductView[] {
    const feeds = new Map(this.store.listFeeds().map((feed) => [feed.id, feed]));
    const policies = new Map(this.store.listPolicies().map((policy) => [policy.id, policy]));
    return this.store.listProducts().map((entry) => {
      const feed = feeds.get(entry.feedId);
      return productView(entry, feed, feed ? policies.get(feed.policyId) : undefined);
    });
  }

  /** One product with its chunk list, answered in one call so a public read costs one Registry request. */
  getProduct(slug: string): ProductDetail | undefined {
    const entry = this.store.getProductBySlug(slug);
    if (!entry) return undefined;
    const feed = this.store.getFeed(entry.feedId);
    return { ...productView(entry, feed, feed ? this.store.getPolicy(feed.policyId) : undefined), chunks: entry.chunks };
  }

  claimProducts(feedId: string, slugs: string[]): void {
    this.store.claimProducts(feedId, slugs);
  }

  /**
   * Atomically select a feed's complete product set, and mirror the runner's
   * report in the same transaction when it sends one, so a changed collection
   * costs one Registry call. Unknown feed: `known` is false, so a ghost runner
   * can retire; while the sync is still installing feeds it throws instead,
   * and the runner retries the publication.
   */
  publishProducts(feedId: string, entries: ProductIndexEntry[], report?: RunnerReport): RunnerReportReceipt {
    if (!this.store.getFeed(feedId)) {
      if (!this.syncSettled()) throw new Error("The Registry is still installing feeds; publication will be retried");
      return { known: false, backfillPeers: 0 };
    }
    const at = new Date().toISOString();
    const receipt = this.ctx.storage.transactionSync((): RunnerReportReceipt => {
      this.store.replaceFeedProducts(feedId, entries);
      return report ? ingestRunnerReport(this.store, report, at) : { known: true, backfillPeers: 1 };
    });
    if (report) this.reportIngested();
    return receipt;
  }

  /* ---------- Runner liaison ---------- */

  ingest(report: RunnerReport): RunnerReportReceipt {
    const receipt = this.ctx.storage.transactionSync(() => ingestRunnerReport(this.store, report, new Date().toISOString()));
    if (!receipt.known && this.syncSettled()) receipt.retire = true;
    this.reportIngested();
    return receipt;
  }

  /** Bound the activity mirror: every 200 reports, forget what is older than its newest entries. */
  private reportIngested(): void {
    this.reportsSincePrune += 1;
    if (this.reportsSincePrune >= 200) {
      this.reportsSincePrune = 0;
      this.store.pruneActivity();
      this.store.pruneOutages(new Date(Date.now() - OUTAGE_KEEP_MS).toISOString());
    }
  }

  listAcquisitions(limit: number, feedId?: string): Acquisition[] {
    return this.store.listActivity(limit, feedId);
  }

  activityBetween(from: string, to: string, limit: number, feedId?: string): ActivityWindow {
    return this.store.listActivityBetween(from, to, limit, feedId);
  }

  /** Outages overlapping [from, to), newest first, and since when the Registry has tracked them. */
  outages(from: string, to: string): OutageWindow {
    return { trackedSince: this.store.getState<string>(OUTAGES_SINCE_KEY) ?? null, items: this.store.outagesBetween(from, to).filter((outage) => isSustained(outage, to)) };
  }

  /**
   * Daily, instead of two R2 SQL queries per batch: compare yesterday's
   * committed history row counts with what the lake tables hold, for a sample
   * of batches, in two queries. Mismatches are reported, never silently fixed.
   */
  private async auditLake(): Promise<void> {
    const now = Date.now();
    const to = new Date(Math.floor(now / 86_400_000) * 86_400_000).toISOString();
    const from = new Date(Date.parse(to) - 86_400_000).toISOString();
    const sample = this.store
      .listActivityBetween(from, to, 5_000)
      .items.filter((item) => (item.historyRows ?? 0) > 0)
      .slice(0, 40);
    const audit: LakeAudit = { at: new Date(now).toISOString(), window: { from, to }, checked: sample.length, mismatches: [] };
    if (sample.length > 0) {
      const ids = sample.map((item) => `'${item.id.replaceAll("'", "''")}'`).join(",");
      const found = new Map<string, number>();
      try {
        for (const table of ["records", "points"] as const) {
          const result = await runLakeQuery(
            this.env,
            `SELECT batch_id, COUNT(DISTINCT revision_id) AS count FROM open_data.${table} WHERE __ingest_ts >= TIMESTAMP '${from}' AND batch_id IN (${ids}) GROUP BY batch_id LIMIT 1000`,
            `audit:${table}`,
          );
          for (const row of result.rows) found.set(String(row.batch_id), (found.get(String(row.batch_id)) ?? 0) + Number(row.count ?? 0));
        }
        for (const item of sample) {
          const count = found.get(item.id) ?? 0;
          if (count < (item.historyRows ?? 0)) audit.mismatches.push({ acquisitionId: item.id, feedId: item.feedId, expected: item.historyRows ?? 0, found: count });
        }
      } catch (error) {
        audit.error = String(error).slice(0, 500);
      }
    }
    // Nothing reads the result back; it is a log line, and a mismatch or a failed query is an error.
    const line = JSON.stringify({ event: "lake_audit", ...audit });
    if (audit.error || audit.mismatches.length) console.error(line);
    else console.log(line);
  }
}

function productView(entry: ProductSummary, feed: Feed | undefined, policy: FeedPolicy | undefined): ProductView {
  const lastSuccess = feed?.lastSuccessAt ? Date.parse(feed.lastSuccessAt) : Date.parse(entry.updatedAt);
  const staleAfterSeconds = feed?.staleAfterSeconds ?? 86_400;
  const history = policy !== undefined && keepsHistory(policy, entry.productKey);
  return {
    ...entry,
    stale: lastSuccess + staleAfterSeconds * 1000 < Date.now(),
    exposeHistory: history,
    historyMode: history ? "changes" : "latest",
    licence: policy?.serving.licence ?? null,
    attribution: policy?.serving.attribution ?? null,
    staleAfterSeconds,
    cadenceSeconds: policy?.collection.cadenceSeconds ?? 86_400,
  };
}

function nextAuditTime(now: number): number {
  const day = Math.floor(now / 86_400_000) * 86_400_000;
  return day + 86_400_000 + 3 * 60 * 60_000;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * A FeedRunner: one Durable Object per feed. It owns the feed's schedule,
 * checkpoint, product entries, large-product entity index, and history
 * outbox. Collection itself runs in a Workflow; the runner only answers short
 * RPC calls, so waiting on sources is never billed as Durable Object duration.
 * It needs no operator: failures cool down and retry, a feed whose source
 * offers history walks it once, and a feed the Registry dropped retires itself.
 */
export class FeedRunner extends DurableObject<Env> {
  private readonly core: RunnerCore;
  /** Reports the Registry accepted from this instance; a call that saw one sent after its commit needs no second. */
  private reportsSent = 0;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.core = new RunnerCore(ctx.storage.sql, (body) => ctx.storage.transactionSync(body), {
      objects: new ObjectStore(new R2SnapshotStore(env.DATA_OBJECTS)),
      publish: (entries) => this.publishWithReport(entries),
      claim: async (feedId, slugs) => registry(env).claimProducts(feedId, slugs),
      lakeAvailable: PipelinesLake.available(lakeStreams(env)),
      now: () => Date.now(),
    });
    this.core.migrate();
  }

  /* ---------- Executor calls ---------- */

  begin(acquisitionId: string): BeginResult {
    return this.core.begin(acquisitionId);
  }

  declare(acquisitionId: string, input: DeclareInput): Promise<DeclaredProduct[]> {
    return this.core.declare(acquisitionId, input);
  }

  promote(productKey: string): Promise<void> {
    return this.core.promote(productKey);
  }

  stageRecords(acquisitionId: string, productKey: string, rows: StagedRecord[]): StageResult {
    return this.core.stageRecords(acquisitionId, productKey, rows);
  }

  sweepRecords(acquisitionId: string, productKey: string, seen: Uint8Array, retract: boolean): SweepResult {
    return this.core.sweepRecords(acquisitionId, productKey, seen, retract);
  }

  appendOutbox(acquisitionId: string, table: LakeTable, rowsJson: string, rows: number): void {
    this.core.appendOutbox(acquisitionId, table, rowsJson, rows);
  }

  async commit(acquisitionId: string, input: CommitInput): Promise<CommitResult> {
    // The commit's transaction runs before its first await, so any report sent from here on describes the committed state.
    const reports = this.reportsSent;
    try {
      return await this.core.commit(acquisitionId, input);
    } finally {
      // A publication carries the report; only a commit that published nothing reports on its own.
      await this.settle(this.reportsSent === reports);
    }
  }

  async unchanged(acquisitionId: string, checkpoint: SourceCheckpoint): Promise<void> {
    this.core.unchanged(acquisitionId, checkpoint);
    await this.settle();
  }

  async historyExhausted(acquisitionId: string): Promise<void> {
    this.core.historyExhausted(acquisitionId);
    await this.settle();
  }

  async fail(acquisitionId: string, failure: CollectionFailure): Promise<void> {
    this.core.fail(acquisitionId, failure);
    await this.settle();
  }

  pendingOutbox(limit: number): OutboxBlob[] {
    return this.core.pendingOutbox(limit);
  }

  /** Acknowledge delivered blobs and hand back up to `next` more, so delivering a page costs one call. */
  async ackOutbox(seqs: number[], next = 0): Promise<OutboxBlob[]> {
    this.core.ackOutbox(seqs);
    if (this.core.committedOutboxRows() > 0) return this.core.pendingOutbox(next);
    // All delivered: the wake-up armed at commit to catch undelivered history has nothing left to do.
    await this.rearm();
    return [];
  }

  /* ---------- Registry calls ---------- */

  /**
   * Take the definition the Registry resolved. The same one again changes
   * nothing and reports nothing, unless the Registry asks for a report because
   * it holds no status for this feed. Returns whether it changed.
   */
  async configure(feed: Feed, policy: FeedPolicy, report = false): Promise<boolean> {
    const changed = this.core.configure(feed, policy);
    if (changed) await this.settle();
    else if (report) await this.report();
    return changed;
  }

  /** The Registry dropped this feed: stop taking work, deliver what history is left, then delete everything. */
  async decommission(): Promise<void> {
    this.core.decommission();
    await this.ctx.storage.setAlarm(Date.now());
  }

  /* ---------- Reads ---------- */

  feed(): Feed | undefined {
    const definition = this.core.feed();
    return definition ? { ...definition, ...this.core.status() } : undefined;
  }

  listAcquisitions(limit = 50): Acquisition[] {
    return this.core.listAcquisitions(limit);
  }

  getAcquisition(id: string): Acquisition | undefined {
    return this.core.getAcquisition(id);
  }

  /* ---------- Scheduling ---------- */

  override async alarm(): Promise<void> {
    if (this.core.retiring()) {
      await this.finishRetirement();
      return;
    }
    if (!this.core.feed()) return;
    try {
      await this.core.publishPending();
    } catch (error) {
      if (String(error).includes("no longer registered")) {
        this.core.decommission();
        await this.finishRetirement();
        return;
      }
      console.warn(JSON.stringify({ event: "publication_retry_failed", error: String(error) }));
    }
    // Starting a run changes nothing the Registry shows until the run ends, and its end reports. An alarm reports only what it ended itself.
    let ended = false;
    try {
      const overdue = this.core.overdue();
      if (overdue) ended = await this.checkExecutor(overdue);
      // The Workflow delivers what it commits. History still waiting after ten minutes (its executor died, or a retried
      // step found the work done) triggers a drain here, which then sends everything committed.
      if (!this.core.runtime().runningAcquisitionId && this.core.hasUndeliveredHistory(new Date(Date.now() - LEFTOVER_HISTORY_AFTER_MS).toISOString()))
        ended = (await this.drainLeftoverHistory()) > 0 || ended;
      const due = this.core.takeDue();
      if (due) ended = !(await this.start(due)) || ended;
      await this.core.collectGarbage();
    } catch (error) {
      ended = true;
      console.error(JSON.stringify({ event: "runner_alarm_failed", feedId: this.core.feed()?.id, error: String(error) }));
    }
    await this.settle(ended);
  }

  /** Hand an acquisition to a Workflow; false when it could not start and was recorded as failed. */
  private async start(acquisition: Acquisition): Promise<boolean> {
    const feed = this.core.requireFeed();
    const policy = this.core.requirePolicy();
    const instanceId = `${acquisition.id}-${Date.now().toString(36)}`;
    this.core.markStarted(acquisition.id, instanceId);
    try {
      await this.env.COLLECTIONS.create({
        id: instanceId,
        params: { feedId: feed.id, acquisitionId: acquisition.id, gatekeeperKind: feed.gatekeeperKind, timeoutSeconds: policy.collection.timeoutSeconds },
      });
      return true;
    } catch (error) {
      this.core.fail(acquisition.id, { message: `Could not start the collection executor: ${String(error)}`, retryable: true });
      return false;
    }
  }

  /** The watchdog fired: ask the Workflow whether the executor is still alive. True when it was given up and recorded as failed. */
  private async checkExecutor(acquisitionId: string): Promise<boolean> {
    const instanceId = this.core.runtime().runningInstanceId;
    let status = "unknown";
    try {
      if (instanceId) status = (await (await this.env.COLLECTIONS.get(instanceId)).status()).status;
    } catch (error) {
      console.warn(JSON.stringify({ event: "executor_status_unavailable", acquisitionId, error: String(error) }));
    }
    if (["queued", "running", "waiting", "paused", "waitingForPause"].includes(status)) {
      this.core.extendWatchdog(acquisitionId);
      return false;
    }
    this.core.fail(acquisitionId, { message: `Collection executor stopped without reporting (workflow ${status})`, retryable: true, interrupted: status !== "complete" });
    return true;
  }

  /** Send history no executor delivered; returns how many blobs went. */
  private async drainLeftoverHistory(): Promise<number> {
    const lake = new PipelinesLake(lakeStreams(this.env));
    const outbox = {
      pendingOutbox: async (limit: number) => this.core.pendingOutbox(limit),
      ackOutbox: async (seqs: number[], next: number) => {
        this.core.ackOutbox(seqs);
        return this.core.pendingOutbox(next);
      },
    };
    return (await drainOutbox(outbox, (table, rows) => lake.send(table, rows), LEFTOVER_ALARM_BLOBS)).delivered;
  }

  /** An acquisition ended or the definition arrived: bound the bookkeeping, plan the next wake-up, and tell the Registry unless it already knows. */
  private async settle(report = true): Promise<void> {
    this.core.prune();
    await this.rearm();
    if (report) await this.report();
  }

  /** Wake up for the next thing this runner has to do; with nothing to do, sleep until someone calls. */
  private async rearm(): Promise<void> {
    const next = this.core.nextAlarm();
    if (next === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(next);
  }

  private reportFor(feed: Feed): RunnerReport {
    return { feedId: feed.id, gatekeeperKind: feed.gatekeeperKind, status: this.core.status(), acquisitions: this.core.listAcquisitions(10) };
  }

  /** Select the feed's products and report this runner's state in one Registry call. */
  private async publishWithReport(entries: ProductIndexEntry[]): Promise<boolean> {
    const feed = this.core.requireFeed();
    const receipt = await registry(this.env).publishProducts(feed.id, entries, this.reportFor(feed));
    if (!receipt.known) return false;
    this.reportsSent += 1;
    this.core.backfillPeers = Math.max(1, receipt.backfillPeers);
    return true;
  }

  private async report(): Promise<void> {
    const feed = this.core.feed();
    if (!feed) return;
    let receipt: RunnerReportReceipt;
    try {
      receipt = await registry(this.env).ingest(this.reportFor(feed));
    } catch (error) {
      // Reports are idempotent and carry the latest acquisitions: the next one repairs whatever this one missed.
      console.warn(JSON.stringify({ event: "registry_report_failed", feedId: feed.id, error: String(error) }));
      return;
    }
    this.reportsSent += 1;
    this.core.backfillPeers = Math.max(1, receipt.backfillPeers);
    if (receipt.retire && !this.core.retiring()) {
      console.warn(JSON.stringify({ event: "runner_unknown_to_registry", feedId: feed.id }));
      this.core.decommission();
      await this.ctx.storage.setAlarm(Date.now());
    }
  }

  /** Retiring: let a running executor finish or time out, deliver the history left, then delete everything. */
  private async finishRetirement(): Promise<void> {
    try {
      const overdue = this.core.overdue();
      if (overdue) await this.checkExecutor(overdue);
      const runtime = this.core.runtime();
      if (runtime.runningAcquisitionId) {
        await this.ctx.storage.setAlarm(runtime.watchdogAt ? Date.parse(runtime.watchdogAt) : Date.now() + 5 * 60_000);
        return;
      }
      if (this.core.committedOutboxRows() > 0) await this.drainLeftoverHistory();
    } catch (error) {
      console.warn(JSON.stringify({ event: "runner_retirement_delayed", feedId: this.core.feed()?.id, error: String(error) }));
    }
    await this.retire();
  }

  /** Delete this runner's serving objects and state, never undelivered history. */
  private async retire(): Promise<void> {
    if (!this.core.canRetire()) {
      console.error(JSON.stringify({ event: "runner_retirement_blocked", feedId: this.core.feed()?.id, reason: "undelivered history" }));
      await this.ctx.storage.setAlarm(Date.now() + 60 * 60_000);
      return;
    }
    await new R2SnapshotStore(this.env.DATA_OBJECTS).delete(this.core.servingKeys());
    console.warn(JSON.stringify({ event: "runner_retired", feedId: this.core.feed()?.id }));
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
  }
}
