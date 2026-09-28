import { DurableObject } from "cloudflare:workers";
import { NormalizedInputError, type CatalogFeed } from "@open-data-pt/contract";

import { cadenceFloorOf, checkForVersion, syncStep, withCadenceFloor, type SyncPorts, type SyncProgress, type SyncState } from "#/registry/catalog-sync";
import type { ManifestChunk } from "#/serving/chunks";
import { definitionFingerprint, keepsHistory, type Acquisition, type Feed, type ProductIndexEntry, type ProductSummary } from "#/registry/feed-model";
import { catalogVersionOf, gatekeeperOf } from "#/collection/gatekeeper";
import { EMPTY_VOCABULARIES, Vocabulary, checkedCatalog, type Vocabularies, type VocabularyRef } from "#/registry/vocabulary";
import { digest } from "#/hash";
import { ObjectStore } from "#/serving/object-store";
import { QUERY_DEADLINE_SECONDS, runLakeQuery } from "#/history/query";
import { SUMMARY_DAYS_PER_WAKE, SUMMARY_DUE_STATE_KEY, summariseSettledDays } from "#/history/summaries";
import { R2SnapshotStore } from "#/serving/r2-snapshot-store";
import { RegistryStore, type ActivityWindow } from "#/registry/store";
import { ingestRunnerReport, OUTAGE_KEEP_MS, OUTAGES_SINCE_KEY, type OutageWindow, type RunnerReport, type RunnerReportReceipt, isSustained } from "#/registry/reporting";

/** The one Registry's name: every runner and request reaches the same object. */
export const REGISTRY_ROOM = "main";

const SYNC_STATE_KEY = "catalog-sync";
/** The vocabularies the Gatekeeper's catalog last declared: its publishers, licences and topics. */
const CATALOG_STATE_KEY = "catalog";
const AUDIT_DUE_KEY = "lake-audit-due";
/** A history slot outlives its query's own deadline by a margin, and is then taken back from a request that cannot still hold it. */
const HISTORY_SLOT_TTL_MS = (QUERY_DEADLINE_SECONDS + 15) * 1000;

/**
 * A product as the public API lists it: the selected entry without its chunk
 * list, and what its feed and its policy say about it, computed at read time.
 */
export interface ProductView extends ProductSummary {
  stale: boolean;
  /** This product's history is kept and served: its policy keeps history and does not leave this product out. */
  exposeHistory: boolean;
  /** `changes` when this product keeps history, `latest` when it serves current state only. */
  historyMode: "changes" | "latest";
  licence: VocabularyRef | null;
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

/** The Registry, as a runner or a request calls it. */
export function registryOf(env: Env): DurableObjectStub<Registry> {
  return env.Registry.getByName(REGISTRY_ROOM);
}

/**
 * The Registry: feed definitions, a mirror of runner status and recent
 * acquisitions, slug ownership, and the product index the public API reads.
 * Nobody administers it. Its alarm keeps the feeds equal to the Gatekeeper's
 * catalog (installing, updating and retiring them, see catalog-sync.ts) and
 * runs the daily lake delivery audit. Product
 * staleness is computed when products are read.
 */
export class Registry extends DurableObject<Env> {
  private readonly store: RegistryStore;
  /** The history queries holding a slot, by the id their request drew, and when each took it. */
  private readonly activeHistoryQueries = new Map<string, number>();
  private reportsSincePrune = 0;
  /** The sync step in flight: its RPC round trips let other events in, and two steps must never interleave. */
  private syncing: Promise<SyncProgress> | undefined;
  /** The stored catalog, expanded once and kept until the Gatekeeper declares another. */
  private vocabularyCache: Vocabulary | undefined;

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

  /**
   * Lend one of the four history slots to the query that names itself. Asking
   * twice with the same id is the same question asked twice, not a second
   * query: a reply lost on the way back is retried through a fresh stub, and
   * counting that retry would strand a slot until this instance is evicted.
   * A slot older than the query deadline is taken back, because the request
   * that held it cannot still be running.
   */
  tryStartHistoryQuery(queryId: string): boolean {
    const now = Date.now();
    for (const [id, taken] of this.activeHistoryQueries) {
      if (now - taken > HISTORY_SLOT_TTL_MS) this.activeHistoryQueries.delete(id);
    }
    if (this.activeHistoryQueries.has(queryId)) return true;
    if (this.activeHistoryQueries.size >= 4) return false;
    this.activeHistoryQueries.set(queryId, now);
    return true;
  }

  finishHistoryQuery(queryId: string): void {
    this.activeHistoryQueries.delete(queryId);
  }

  override async alarm(): Promise<void> {
    if (this.env.CATALOG_TOKEN) await this.auditIfDue();
    let retryIn = 0;
    try {
      await this.syncCatalog();
    } catch (error) {
      // Never a tight loop: a step that throws (not one whose operations fail) waits a minute.
      retryIn = 60_000;
      console.error(JSON.stringify({ event: "catalog_sync_failed", error: String(error) }));
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

  /* ---------- Keeping feeds equal to the Gatekeeper's catalog ---------- */

  /**
   * One sync step; the alarm calls it and runs another at once while work is
   * queued. `check` compares the catalog now instead of on schedule.
   */
  syncCatalog(check = false): Promise<SyncProgress> {
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
      readCatalog: () => this.readCatalog(),
      catalogVersion: () => catalogVersionOf(this.env),
      feeds: () => this.store.listFeeds().map((feed) => ({ id: feed.id, slug: feed.slug })),
      apply: (feed) => this.installFeed(feed),
      retire: (feedId) => this.retireFeed(feedId),
      load: () => this.store.getState<SyncState>(SYNC_STATE_KEY),
      save: (state) => this.store.setState(SYNC_STATE_KEY, state),
      now: () => Date.now(),
    };
  }

  /**
   * The feeds the Gatekeeper's catalog lists, each already resolved. Its
   * vocabularies are stored on the way, so the feeds are installed against the
   * vocabularies declared with them. A Gatekeeper that does not answer, answers
   * in another shape (one of another release, for a minute during a deploy), or
   * lists nothing, is broken rather than emptied.
   */
  private async readCatalog(): Promise<CatalogFeed[] | undefined> {
    try {
      const { feeds, ...vocabularies } = checkedCatalog(await gatekeeperOf(this.env).catalog());
      if (feeds.length === 0) throw new Error("The Gatekeeper listed no feeds");
      if (vocabularies.publishers.length === 0) throw new Error("The Gatekeeper declared no publishers");
      this.storeVocabularies(vocabularies);
      return feeds;
    } catch (error) {
      console.warn(JSON.stringify({ event: "gatekeeper_unavailable", error: String(error) }));
      return undefined;
    }
  }

  /** Every publisher, licence and topic the Gatekeeper last declared; empty until it first answers. */
  catalog(): Vocabularies {
    return this.store.getState<Vocabularies>(CATALOG_STATE_KEY) ?? EMPTY_VOCABULARIES;
  }

  private vocabulary(): Vocabulary {
    this.vocabularyCache ??= new Vocabulary(this.catalog());
    return this.vocabularyCache;
  }

  /** Written only when they changed: a Gatekeeper that says the same thing every check costs one read. */
  private storeVocabularies(vocabularies: Vocabularies): void {
    if (JSON.stringify(this.store.getState<Vocabularies>(CATALOG_STATE_KEY)) === JSON.stringify(vocabularies)) return;
    this.store.setState(CATALOG_STATE_KEY, vocabularies);
    this.vocabularyCache = undefined;
  }

  /**
   * Install a feed as the catalog resolved it and hand the definition to its
   * runner, which ignores one it already has. A known slug keeps its feed ID
   * (lake history is keyed by it); a new slug gets an ID derived from it, so a
   * reset Registry installs it under the same ID again.
   */
  private async installFeed(listed: CatalogFeed): Promise<void> {
    // A local session polls politely: `pnpm dev` sets a floor under every cadence, and a deployment sets none.
    const input = withCadenceFloor(listed, cadenceFloorOf(this.env.DEV_MIN_CADENCE_SECONDS));
    const unknown = this.vocabulary().unknownKey(input);
    if (unknown !== undefined) throw new NormalizedInputError(`${input.slug} names ${unknown}`);
    const existing = this.store.getFeedBySlug(input.slug);
    const now = new Date().toISOString();
    const sameSource =
      existing?.resourceKey === input.resourceKey && existing.eventTimed === input.eventTimed && JSON.stringify(existing.history ?? null) === JSON.stringify(input.history ?? null);
    const candidate: Feed = {
      ...input,
      id: existing?.id ?? `feed_${digest(`feed:${input.slug}`)}`,
      enabled: true,
      // A feed of one product names it as the feed is named, so a new name is a new product name: the next collection
      // reads the source whole rather than trusting a checkpoint from under the old one.
      feedEpoch: sameSource && existing.title === input.title && existing.description === input.description ? existing.feedEpoch : now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const unchanged = existing !== undefined && definitionFingerprint(existing) === definitionFingerprint(candidate);
    const feed: Feed = unchanged ? { ...candidate, updatedAt: existing.updatedAt } : candidate;
    if (!unchanged) this.store.upsertFeed(feed);
    // A runner re-sent what it already has reports nothing, unless this Registry holds no status for it (a fresh or reset Registry).
    await this.env.FeedRunner.getByName(feed.id).configure(feed, existing?.consecutiveFailures === undefined);
  }

  /** The runner first stops taking work (so a failure here leaves the feed listed and the next check retries), then the feed is forgotten. */
  private async retireFeed(feedId: string): Promise<void> {
    await this.env.FeedRunner.getByName(feedId).decommission();
    this.ctx.storage.transactionSync(() => this.store.deleteFeed(feedId));
    console.warn(JSON.stringify({ event: "feed_retired", feedId }));
  }

  /* ---------- Feeds ---------- */

  listFeeds(): Feed[] {
    return this.store.listFeeds();
  }

  getFeed(id: string): Feed | undefined {
    return this.store.getFeed(id);
  }

  /* ---------- Products ---------- */

  listProducts(): ProductView[] {
    const feeds = new Map(this.store.listFeeds().map((feed) => [feed.id, feed]));
    const vocabulary = this.vocabulary();
    return this.store.listProducts().map((entry) => productView(entry, feeds.get(entry.feedId), vocabulary));
  }

  /** One product with its chunk list, answered in one call so a public read costs one Registry request. */
  getProduct(slug: string): ProductDetail | undefined {
    const entry = this.store.getProductBySlug(slug);
    if (!entry) return undefined;
    const feed = this.store.getFeed(entry.feedId);
    return { ...productView(entry, feed, this.vocabulary()), chunks: entry.chunks };
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
    if (report) {
      this.reportIngested();
      this.noticeCatalogVersion(report.catalogVersion);
    }
    return receipt;
  }

  /* ---------- Runner liaison ---------- */

  ingest(report: RunnerReport): RunnerReportReceipt {
    const receipt = this.ctx.storage.transactionSync(() => ingestRunnerReport(this.store, report, new Date().toISOString()));
    if (!receipt.known && this.syncSettled()) receipt.retire = true;
    this.reportIngested();
    this.noticeCatalogVersion(report.catalogVersion);
    return receipt;
  }

  /** A runner heard a Gatekeeper catalog the last check did not read: check it now rather than on schedule. */
  private noticeCatalogVersion(version: string | undefined): void {
    const next = checkForVersion(this.store.getState<SyncState>(SYNC_STATE_KEY), version, Date.now());
    if (!next) return;
    this.store.setState(SYNC_STATE_KEY, next);
    console.log(JSON.stringify({ event: "catalog_version_heard", version }));
    void this.ctx.storage.setAlarm(next.nextCheckAt);
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

function productView(entry: ProductSummary, feed: Feed | undefined, vocabulary: Vocabulary): ProductView {
  const lastSuccess = feed?.lastSuccessAt ? Date.parse(feed.lastSuccessAt) : Date.parse(entry.updatedAt);
  const staleAfterSeconds = feed?.staleAfterSeconds ?? 86_400;
  const history = feed !== undefined && keepsHistory(feed.policy, entry.productKey);
  return {
    ...entry,
    stale: lastSuccess + staleAfterSeconds * 1000 < Date.now(),
    exposeHistory: history,
    historyMode: history ? "changes" : "latest",
    // A product is served under its feed's terms.
    licence: feed ? vocabulary.licenceRef(feed.licence) : null,
    attribution: feed?.attribution ?? null,
    staleAfterSeconds,
    cadenceSeconds: feed?.policy.cadenceSeconds ?? 86_400,
  };
}

function nextAuditTime(now: number): number {
  const day = Math.floor(now / 86_400_000) * 86_400_000;
  return day + 86_400_000 + 3 * 60 * 60_000;
}
