import { DurableObject } from "cloudflare:workers";
import type { SourceCheckpoint } from "@open-data-pt/contract";

import { drainOutbox } from "#/collection/engine";
import type { Acquisition, Feed, ProductIndexEntry } from "#/registry/feed-model";
import { catalogVersionOf } from "#/collection/gatekeeper";
import { PipelinesLake, lakeStreams, type LakeTable } from "#/history/lake";
import { ObjectStore } from "#/serving/object-store";
import { R2SnapshotStore } from "#/serving/r2-snapshot-store";
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
} from "#/runner/core";
import { registryOf } from "#/registry/registry";
import type { RunnerReport, RunnerReportReceipt } from "#/registry/reporting";

/** History its Workflow has not delivered after this long is drained by the runner's alarm. */
const LEFTOVER_HISTORY_AFTER_MS = 10 * 60_000;
/** An alarm pays Durable Object duration while it waits on Pipelines, so it sends a bounded share; the next wake-up sends the rest. */
const LEFTOVER_ALARM_BLOBS = 40;

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
      claim: async (feedId, slugs) => registryOf(env).claimProducts(feedId, slugs),
      lakeAvailable: PipelinesLake.available(lakeStreams(env)),
      now: () => Date.now(),
      random: () => Math.random(),
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
  async configure(feed: Feed, report = false): Promise<boolean> {
    const changed = this.core.configure(feed);
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
      // History that will not go never holds back the next collection: it is retried on its own schedule.
      if (!this.core.runtime().runningAcquisitionId && this.core.hasUndeliveredHistory(new Date(Date.now() - LEFTOVER_HISTORY_AFTER_MS).toISOString())) {
        try {
          ended = (await this.drainLeftoverHistory()) > 0 || ended;
        } catch (error) {
          console.error(JSON.stringify({ event: "leftover_history_failed", feedId: this.core.feed()?.id, error: String(error) }));
        }
      }
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
    const instanceId = `${acquisition.id}-${Date.now().toString(36)}`;
    this.core.markStarted(acquisition.id, instanceId);
    try {
      await this.env.COLLECTIONS.create({
        id: instanceId,
        params: { feedId: feed.id, acquisitionId: acquisition.id, timeoutSeconds: feed.policy.timeoutSeconds },
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

  /** This runner's state, and the catalog version of the Gatekeeper it collects through, which tells the Registry of a release. */
  private async reportFor(feed: Feed): Promise<RunnerReport> {
    const report: RunnerReport = { feedId: feed.id, library: feed.library, status: this.core.status(), acquisitions: this.core.listAcquisitions(10) };
    const version = await catalogVersionOf(this.env);
    if (version !== undefined) report.catalogVersion = version;
    return report;
  }

  /** Select the feed's products and report this runner's state in one Registry call. */
  private async publishWithReport(entries: ProductIndexEntry[]): Promise<boolean> {
    const feed = this.core.requireFeed();
    const receipt = await registryOf(this.env).publishProducts(feed.id, entries, await this.reportFor(feed));
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
      receipt = await registryOf(this.env).ingest(await this.reportFor(feed));
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
