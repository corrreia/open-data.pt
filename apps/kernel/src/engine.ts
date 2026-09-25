import {
  NORMALIZED_PROTOCOL,
  NormalizedInputError,
  assertCollectionResult,
  isPermanentCollectionError,
  toJsonObject,
  type CanonicalRecord,
  type CollectionRequest,
  type CollectionResult,
  type Completeness,
  type JsonObject,
  type NormalizedProductHeader,
  type ProductFinalization,
  type ProductUpdateMode,
  type SeriesPoint,
  type SourceCheckpoint,
} from "@open-data-pt/contract";

import { BYTES_PER_CODE_UNIT, SMALL_PRODUCT_BYTES, STAGE_BYTES, utf8Length } from "./blob-budget";
import { buildChunks, chunkListProblem, compareKeys, parseChunkRows, servedIdentity, type ChunkSink, type ServingRow } from "./chunks";
import { CollectionDeadline } from "./collection-deadline";
import { keepsHistory, type ProductIndexEntry } from "./feed-model";
import { readFrames, type CompleteFrame, type FrameScope, type HeaderFrame } from "./frames";
import { digest, stableStringify } from "./hash";
import type { LakeTable } from "./lake";
import {
  keys,
  WINDOW,
  type ChangeItem,
  type ChangesWindow,
  type ObjectStore,
  type PointChangeItem,
  type PointItem,
  type SeriesChangesWindow,
  type SeriesWindow,
} from "./object-store";
import { OutboxBuffer } from "./outbox";
import { RecentChanges, prepareRecord, recordRevision, retractionRevision, revisionId, servingJson, type PreparedRecord, type RecordContext } from "./records";
import {
  SMALL_PRODUCT_ROWS,
  declareProducts,
  type BeginResult,
  type CollectionFailure,
  type CollectionPlan,
  type CommitInput,
  type CommitResult,
  type DeclaredProduct,
  type DeclareInput,
  type OutboxBlob,
  type ProductCommit,
  type StagedRecord,
  type StageResult,
  type SweepResult,
} from "./runner-core";

/**
 * One collection, run by an executor outside the FeedRunner's billed
 * duration. The runner is reached only through these small calls; the
 * Gatekeeper stream is consumed frame by frame with bounded memory.
 */
export interface RunnerPort {
  begin(acquisitionId: string): Promise<BeginResult>;
  declare(acquisitionId: string, input: DeclareInput): Promise<DeclaredProduct[]>;
  promote(productKey: string): Promise<void>;
  stageRecords(acquisitionId: string, productKey: string, rows: StagedRecord[]): Promise<StageResult>;
  sweepRecords(acquisitionId: string, productKey: string, seen: Uint8Array, retract: boolean): Promise<SweepResult>;
  appendOutbox(acquisitionId: string, table: LakeTable, rowsJson: string, rows: number): Promise<void>;
  commit(acquisitionId: string, input: CommitInput): Promise<CommitResult>;
  unchanged(acquisitionId: string, checkpoint: SourceCheckpoint): Promise<void>;
  historyExhausted(acquisitionId: string): Promise<void>;
  fail(acquisitionId: string, failure: CollectionFailure): Promise<void>;
  pendingOutbox(limit: number): Promise<OutboxBlob[]>;
  /** Acknowledge delivered blobs and take up to `next` more committed ones, in one call. */
  ackOutbox(seqs: number[], next: number): Promise<OutboxBlob[]>;
}

export interface CollectingGatekeeper {
  collect(request: CollectionRequest): Promise<CollectionResult>;
}

/** Sends history rows to the lake; resolves once they are accepted. */
export type LakeSend = (table: LakeTable, rows: JsonObject[]) => Promise<void>;

export interface EnginePorts {
  runner: RunnerPort;
  gatekeeper: CollectingGatekeeper;
  objects: ObjectStore;
  /** With a lake, a collection delivers the history it committed at once and leaves only what it could not send. */
  lake?: LakeSend;
}

export interface EngineOutcome {
  /** `done`: the acquisition had already finished, so a retried step found nothing to do. */
  status: "succeeded" | "unchanged" | "done";
  rows: number;
  revisions: number;
  /** History rows this collection committed to the outbox. */
  historyRows: number;
  /** Committed history is still waiting: the executor's delivery step sends it. */
  undelivered: boolean;
}

/** A small product outgrew in-memory comparison; the runner must seed its index before a retry. */
export class PromotionRequired extends Error {
  constructor(
    readonly productKey: string,
    outgrew = `${SMALL_PRODUCT_ROWS} rows`,
  ) {
    super(`Product ${productKey} exceeded ${outgrew}; promoting it to the SQLite index`);
    this.name = "PromotionRequired";
  }
}

/** The Gatekeeper reported a typed failure. */
export class CollectionFailed extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "CollectionFailed";
  }
}

/** How a thrown error should be reported to the runner once retries are exhausted. */
export function failureFrom(error: Error): CollectionFailure {
  if (error instanceof CollectionFailed) {
    const failure: CollectionFailure = { message: error.message, retryable: error.retryable };
    if (error.retryAfterSeconds !== undefined) failure.retryAfterSeconds = error.retryAfterSeconds;
    return failure;
  }
  if (isPermanentCollectionError(error)) return { message: error.message, retryable: false };
  const interrupted = /memory|exceeded (its )?cpu|cpu time limit|script will never generate a response|internal error|terminated|isolate/i.test(error.message);
  return { message: error.message, retryable: true, interrupted };
}

/** A collection step's result: the engine's outcome, or a failure the runner records and retries by itself. */
export type StepResult = { outcome: EngineOutcome } | { failure: CollectionFailure };

/**
 * One collection attempt as the Workflow's step runs it. A failure the Gatekeeper reported, a missed deadline, or an
 * error no retry can cure comes back as a value for the runner, which retries after the source's Retry-After. Thrown
 * out of the step, each one left that Workflow invocation pending until the runtime cancelled it and logged code that
 * hung. Only errors a quick step retry can cure (a lost connection, a restarted object, a product to promote) are thrown.
 */
export async function collectionStep(acquisitionId: string, ports: EnginePorts): Promise<StepResult> {
  try {
    return { outcome: await runCollection(acquisitionId, ports) };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    if (failure instanceof PromotionRequired) {
      await ports.runner.promote(failure.productKey);
      throw failure;
    }
    const classified = failureFrom(failure);
    if (!classified.retryable || failure instanceof CollectionFailed || /deadline/i.test(failure.message)) return { failure: classified };
    throw failure;
  }
}

export async function runCollection(acquisitionId: string, ports: EnginePorts): Promise<EngineOutcome> {
  const begun = await ports.runner.begin(acquisitionId);
  // History an earlier attempt committed is delivered by the runner's alarm if that attempt did not.
  if (begun.kind === "done") return { status: "done", rows: 0, revisions: 0, historyRows: 0, undelivered: false };
  const plan = begun;
  const request: CollectionRequest = {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: acquisitionId,
    feed: { id: plan.feed.id, slug: plan.feed.slug, title: plan.feed.title, description: plan.feed.description },
    resolved: plan.feed.resolved,
    feedEpoch: plan.feed.feedEpoch,
    mode: plan.mode,
    limits: plan.limits,
    deadline: plan.deadline,
    observedAt: plan.observedAt,
  };
  if (plan.checkpoint) request.checkpoint = plan.checkpoint;
  const deadline = new CollectionDeadline(plan.deadline);
  try {
    // SAFETY: the service binding implements FeedGatekeeper; Promise.resolve normalizes the RPC thenable.
    const pending = Promise.resolve(ports.gatekeeper.collect(request)) as Promise<CollectionResult>;
    let result: CollectionResult;
    try {
      result = await deadline.wait(pending);
      assertCollectionResult(result, request.mode);
    } catch (error) {
      void pending.then((late) => (late.kind === "batch" ? late.stream.cancel() : undefined)).catch(() => undefined);
      throw error;
    }
    if (result.kind === "failure") throw new CollectionFailed(`Gatekeeper collection failed: ${result.code}`, result.retryable, result.retryAfterSeconds);
    if (result.kind === "unchanged") {
      await ports.runner.unchanged(acquisitionId, result.checkpoint);
      return { status: "unchanged", rows: 0, revisions: 0, historyRows: 0, undelivered: false };
    }
    if (result.kind === "exhausted") {
      await ports.runner.historyExhausted(acquisitionId);
      return { status: "unchanged", rows: 0, revisions: 0, historyRows: 0, undelivered: false };
    }
    return await consumeBatch(plan, result.stream, ports);
  } finally {
    deadline.close();
  }
}

async function consumeBatch(plan: CollectionPlan, stream: ReadableStream<Uint8Array>, ports: EnginePorts): Promise<EngineOutcome> {
  const acquisitionId = plan.acquisitionId;
  const scope: FrameScope = {
    collectionId: acquisitionId,
    resourceKey: plan.feed.resolved.resourceKey,
    configHash: plan.feed.resolved.configHash,
    feedEpoch: plan.feed.feedEpoch,
    mode: plan.mode,
    deadline: plan.deadline,
    visitedCursors: plan.visitedCursors,
  };
  const outbox = new OutboxBuffer((table, json, rows) => ports.runner.appendOutbox(acquisitionId, table, json, rows));
  const history = plan.mode.kind === "history" ? new HistoryState(plan) : undefined;
  let header: HeaderFrame | undefined;
  let complete: CompleteFrame | undefined;
  const workers = new Map<string, ProductWorker>();
  let rows = 0;
  for await (const frame of readFrames(stream, plan.limits, scope)) {
    if (frame.type === "header") {
      header = frame;
      // Products the feed already serves, compared in memory, need nothing from the runner: their slugs and versions are in the plan.
      // Only a new product (whose slug must be claimed) or one kept in the SQLite index (whose staging reads the declaration) asks it.
      const local = declareProducts(plan.products, frame.products);
      let declared = local;
      if (local.some((product) => !product.previous || product.mode === "large")) {
        const input: DeclareInput = { normalizer: frame.normalizer, products: frame.products };
        if (frame.provenance.sourcePublishedAt) input.sourcePublishedAt = frame.provenance.sourcePublishedAt;
        declared = await ports.runner.declare(acquisitionId, input);
      }
      for (const product of frame.products) {
        const binding = declared.find((candidate) => candidate.productKey === product.productKey);
        if (!binding) throw new NormalizedInputError(`Runner did not declare product ${product.productKey}`);
        const base: WorkerBase = { plan, ports, outbox, header: product, declared: binding, context: recordContext(plan, frame, binding) };
        workers.set(
          product.productKey,
          history
            ? new HistoryWorker(base, history)
            : product.kind === "series"
              ? new SeriesWorker(base)
              : binding.mode === "large"
                ? new LargeRecordWorker(base)
                : new SmallRecordWorker(base),
        );
      }
      continue;
    }
    if (frame.type === "record" || frame.type === "point") {
      rows += 1;
      const worker = workers.get(frame.productKey);
      if (!worker) throw new NormalizedInputError("Normalized row referred to an unknown product");
      if (frame.type === "record") await worker.pushRecord(frame.value);
      else await worker.pushPoint(frame.value);
      continue;
    }
    complete = frame;
  }
  if (!header || !complete) throw new NormalizedInputError("Gatekeeper normalized stream was truncated before completion");
  const finals = new Map((complete.products ?? []).map((item) => [item.productKey, item]));
  const commits: ProductCommit[] = [];
  let revisions = 0;
  for (const [productKey, worker] of workers) {
    const product = header.products.find((candidate) => candidate.productKey === productKey)!;
    const finished = await worker.finish(rulesFor(product, complete, finals.get(productKey)));
    revisions += finished.revisions;
    if (finished.commit) commits.push(finished.commit);
  }
  await outbox.close();
  const watermark = commits
    .map((commit) => commit.entry.watermark)
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1);
  const input: CommitInput = {
    checkpoint: header.checkpoint,
    normalizer: header.normalizer,
    quality: complete.quality,
    completeness: complete.quality.rejectedRecords > 0 ? "partial" : header.completeness,
    rows,
    revisions,
    products: commits,
  };
  if (header.provenance.sourcePublishedAt) input.sourcePublishedAt = header.provenance.sourcePublishedAt;
  const sourceUrl = openableUrl(header.provenance.sourceUrl);
  if (sourceUrl) input.sourceUrl = sourceUrl;
  if (watermark) input.eventTime = watermark;
  if (history) {
    input.history = { exhausted: complete.exhausted === true, floors: history.floors, seen: history.seen, points: history.points, records: history.records };
    if (complete.nextCursor) input.history.nextCursor = complete.nextCursor;
  }
  const committed = await ports.runner.commit(acquisitionId, input);
  const pending = committed.historyRows > 0 || committed.outbox.length > 0;
  const undelivered = pending && !(await deliverNow(ports, committed.outbox));
  return { status: committed.status, rows, revisions, historyRows: committed.historyRows, undelivered };
}

/** Blobs per outbox read: four of at most 900 KB stay far below the RPC payload limit. */
const OUTBOX_PAGE_BLOBS = 4;
/** One Workflow delivery step sends at most this many blobs; the runner's alarm drains the rest. */
export const DELIVERY_STEP_BLOBS = 400;
/** A collection sends this much of what it committed itself (about 14 MB); more is left to its delivery step. */
const INLINE_DELIVERY_BLOBS = 16;

/**
 * Send the history a collection just committed, starting from the blobs the
 * commit handed back. The batch is already durable, so a failure here is
 * never a reason to collect again: it leaves the rest to the delivery step.
 */
async function deliverNow(ports: EnginePorts, first: OutboxBlob[]): Promise<boolean> {
  if (!ports.lake) return false;
  try {
    return (await drainOutbox(ports.runner, ports.lake, INLINE_DELIVERY_BLOBS, first)).done;
  } catch (error) {
    console.warn(JSON.stringify({ event: "inline_history_delivery_failed", error: String(error) }));
    return false;
  }
}

export interface Drained {
  delivered: number;
  /** Nothing committed is left undelivered. */
  done: boolean;
}

/**
 * Deliver committed history rows to Pipelines, acknowledging each page once
 * sent. The acknowledgement returns the next page, so a page costs one runner
 * call; `first`, when given, is a page the caller already holds.
 */
export async function drainOutbox(runner: Pick<RunnerPort, "pendingOutbox" | "ackOutbox">, send: LakeSend, maxBlobs: number, first?: OutboxBlob[]): Promise<Drained> {
  let delivered = 0;
  let blobs = first ?? (await runner.pendingOutbox(Math.min(OUTBOX_PAGE_BLOBS, maxBlobs)));
  while (blobs.length > 0 && delivered < maxBlobs) {
    for (const blob of blobs) {
      // SAFETY: outbox blobs hold JSON arrays of lake rows validated before they were stored.
      await send(blob.table, JSON.parse(blob.rowsJson) as JsonObject[]);
    }
    delivered += blobs.length;
    // Past the budget, one blob is enough to learn whether anything is left.
    blobs = await runner.ackOutbox(
      blobs.map((blob) => blob.seq),
      delivered < maxBlobs ? OUTBOX_PAGE_BLOBS : 1,
    );
  }
  return { delivered, done: blobs.length === 0 };
}

/* ---------- Products ---------- */

interface ProductRules {
  completeness: Completeness;
  updateMode: ProductUpdateMode;
  /** The batch is the whole current membership: absent entities leave current serving. */
  replaceCurrent: boolean;
  /** Absent entities are authoritative deletions and become retraction revisions. */
  retract: boolean;
  final: ProductFinalization | undefined;
}

/** The kernel, not the Gatekeeper, decides what a batch may authorize once every row was seen. */
function rulesFor(product: NormalizedProductHeader, complete: CompleteFrame, final: ProductFinalization | undefined): ProductRules {
  const declared = weaker(product.completeness, final?.completeness ?? product.completeness);
  const completeness: Completeness = complete.quality.rejectedRecords > 0 && declared === "complete" ? "partial" : declared;
  const updateMode: ProductUpdateMode = product.updateMode === "authoritative-snapshot" && completeness !== "complete" ? "partial-snapshot" : product.updateMode;
  const replaceCurrent = (updateMode === "authoritative-snapshot" || updateMode === "source-window") && completeness === "complete";
  // A complete authoritative snapshot is the whole membership: what it leaves out has been deleted.
  const retract = updateMode === "authoritative-snapshot";
  return { completeness, updateMode, replaceCurrent, retract, final };
}

/** Completeness only ever weakens: complete, then partial, then unknown. */
function weaker(left: Completeness, right: Completeness): Completeness {
  const rank = { complete: 0, partial: 1, unknown: 2 } as const;
  return rank[left] >= rank[right] ? left : right;
}

interface WorkerBase {
  plan: CollectionPlan;
  ports: EnginePorts;
  outbox: OutboxBuffer;
  header: NormalizedProductHeader;
  declared: DeclaredProduct;
  context: RecordContext;
}

interface FinishedProduct {
  commit: ProductCommit | undefined;
  revisions: number;
}

interface ProductWorker {
  pushRecord(record: CanonicalRecord): Promise<void>;
  pushPoint(point: SeriesPoint): Promise<void>;
  finish(rules: ProductRules): Promise<FinishedProduct>;
}

function recordContext(plan: CollectionPlan, header: HeaderFrame, declared: DeclaredProduct): RecordContext {
  const context: RecordContext = {
    feedId: plan.feed.id,
    acquisitionId: plan.acquisitionId,
    slug: declared.slug,
    productVersion: declared.version,
    observedAt: plan.observedAt,
    normalizer: header.normalizer,
    baseline: declared.baseline,
    keepHistory: plan.lake && keepsHistory(plan.policy, declared.productKey),
  };
  if (header.provenance.sourcePublishedAt) context.sourcePublishedAt = header.provenance.sourcePublishedAt;
  return context;
}

/** Recent change windows are history too: a product whose history the policy does not keep has none. */
function keepsChangeWindow(base: WorkerBase): boolean {
  return keepsHistory(base.plan.policy, base.header.productKey);
}

/** The entry this acquisition would publish, before storage-specific keys are filled in. */
function nextEntry(base: WorkerBase, rules: ProductRules, changed: boolean): ProductIndexEntry {
  const { header, declared, plan } = base;
  const previous = declared.previous;
  const schema = rules.final?.schema ?? header.schema;
  const watermark = rules.final?.watermark ?? header.watermark ?? previous?.watermark ?? null;
  return {
    id: previous?.id ?? `prd_${crypto.randomUUID()}`,
    slug: declared.slug,
    feedId: plan.feed.id,
    productKey: header.productKey,
    title: header.title,
    description: header.description,
    role: header.role,
    kind: header.kind,
    schema,
    updateMode: rules.updateMode,
    completeness: rules.completeness,
    version: changed ? declared.version : (previous?.version ?? declared.version),
    status: "current",
    currentAcquisitionId: changed ? plan.acquisitionId : (previous?.currentAcquisitionId ?? plan.acquisitionId),
    watermark,
    rowCount: previous?.rowCount ?? 0,
    // A product that became a series lets go of its rows, one that became a table of its points, and one that stopped
    // keeping history of its change windows; the runner deletes what no entry references any more.
    chunks: header.kind === "series" ? null : (previous?.chunks ?? null),
    changesKey: header.kind === "record" && keepsChangeWindow(base) ? (previous?.changesKey ?? null) : null,
    seriesKey: header.kind === "series" ? (previous?.seriesKey ?? null) : null,
    seriesChangesKey: header.kind === "series" && keepsChangeWindow(base) ? (previous?.seriesChangesKey ?? null) : null,
    updatedAt: changed ? plan.observedAt : (previous?.updatedAt ?? plan.observedAt),
    createdAt: previous?.createdAt ?? plan.observedAt,
  };
}

function metadataChanged(previous: ProductIndexEntry | null, entry: ProductIndexEntry): boolean {
  if (!previous) return true;
  return (
    previous.title !== entry.title ||
    previous.description !== entry.description ||
    previous.role !== entry.role ||
    stableStringify(toJsonObject(previous.schema)) !== stableStringify(toJsonObject(entry.schema)) ||
    previous.updateMode !== entry.updateMode ||
    previous.completeness !== entry.completeness ||
    previous.watermark !== entry.watermark
  );
}

async function writeChangeWindow(base: WorkerBase, entry: ProductIndexEntry, fresh: ChangeItem[]): Promise<void> {
  if (!keepsChangeWindow(base) || (fresh.length === 0 && entry.changesKey)) return;
  const previous = base.declared.previous?.changesKey ? await base.ports.objects.read<ChangesWindow>(base.declared.previous.changesKey) : undefined;
  const window: ChangesWindow = { slug: entry.slug, updatedAt: base.plan.observedAt, changes: [...fresh, ...(previous?.changes ?? [])].slice(0, WINDOW.changes) };
  const key = keys.changes(base.plan.feed.id, entry.slug, entry.version);
  await base.ports.objects.write(key, window);
  entry.changesKey = key;
}

function chunkSink(base: WorkerBase, known: ReadonlySet<string>): ChunkSink {
  return {
    prefix: keys.prefix(base.plan.feed.id, base.declared.slug),
    known,
    put: async (key, body) => {
      await base.ports.objects.writeText(key, body);
    },
  };
}

/**
 * Record products up to SMALL_PRODUCT_ROWS rows: compared in memory against the
 * rows currently served, without touching the runner's SQLite. High-churn
 * feeds (vehicle positions every minute) stay free of row writes.
 */
class SmallRecordWorker implements ProductWorker {
  private readonly incoming = new Map<string, PreparedRecord>();
  private incomingWeight = 0;

  constructor(private readonly base: WorkerBase) {}

  async pushRecord(record: CanonicalRecord): Promise<void> {
    const prepared = prepareRecord(record);
    this.incomingWeight -= this.incoming.get(prepared.key)?.weight ?? 0;
    this.incoming.delete(prepared.key);
    this.incoming.set(prepared.key, prepared);
    this.incomingWeight += prepared.weight;
    if (this.incoming.size > SMALL_PRODUCT_ROWS) throw new PromotionRequired(this.base.header.productKey);
    // A product is small when it is light, not only when it is short: what is
    // held here is held again as the rows now served and again as the merge of
    // the two, so a few thousand boundaries weigh more than the isolate has.
    // The weight is a count of code units, and a code unit is two bytes in a
    // string holding one character Latin-1 cannot, so the bound assumes two.
    const bytes = this.incomingWeight * BYTES_PER_CODE_UNIT;
    if (bytes > SMALL_PRODUCT_BYTES) {
      throw new PromotionRequired(this.base.header.productKey, `${SMALL_PRODUCT_BYTES} bytes of rows`);
    }
  }

  async pushPoint(): Promise<void> {
    throw new NormalizedInputError("A point was sent to a record product");
  }

  async finish(rules: ProductRules): Promise<FinishedProduct> {
    const { base } = this;
    const previousRows = new Map<string, { hash: string; json: string }>();
    for (const chunk of base.declared.previous?.chunks ?? []) {
      for (const row of parseChunkRows((await base.ports.objects.readText(chunk.key)) ?? "")) previousRows.set(row.key, { hash: hashOf(row.json), json: row.json });
    }
    const changes = new RecentChanges<ChangeItem>(WINDOW.changes);
    let revisions = 0;
    const next = new Map<string, string>();
    if (!rules.replaceCurrent) for (const [key, row] of previousRows) next.set(key, row.json);
    for (const [key, prepared] of this.incoming) {
      const before = previousRows.get(key);
      if (before && !prepared.removal && before.hash === prepared.hash) {
        next.set(key, before.json);
        continue;
      }
      if (prepared.removal) next.delete(key);
      else next.set(key, servingJson(prepared, base.context));
      const revision = recordRevision(prepared, Boolean(before), base.context);
      changes.add(revision.change);
      revisions += 1;
      if (base.context.keepHistory) await base.outbox.add("records", revision.lake);
    }
    let removed = 0;
    if (rules.replaceCurrent) {
      for (const key of [...previousRows.keys()].sort(compareKeys)) {
        if (next.has(key) || this.incoming.get(key)?.removal) continue;
        removed += 1;
        if (!rules.retract) continue;
        const revision = retractionRevision(key, base.context);
        changes.add(revision.change);
        revisions += 1;
        if (base.context.keepHistory) await base.outbox.add("records", revision.lake);
      }
    }
    const probe = nextEntry(base, rules, true);
    const changed = revisions > 0 || removed > 0 || !base.declared.previous?.chunks || metadataChanged(base.declared.previous, probe);
    if (!changed) return { commit: { productKey: base.header.productKey, changed: false, entry: nextEntry(base, rules, false), mode: "small" }, revisions };
    const entry = nextEntry(base, rules, true);
    const ordered: ServingRow[] = [...next.entries()].sort(([left], [right]) => compareKeys(left, right)).map(([key, json]) => ({ key, json }));
    const chunks = await buildChunks(ordered, chunkSink(base, new Set((base.declared.previous?.chunks ?? []).map((chunk) => chunk.key))));
    const problem = chunkListProblem(chunks, entry.slug);
    if (problem) throw new NormalizedInputError(problem);
    entry.chunks = chunks;
    entry.rowCount = ordered.length;
    await writeChangeWindow(base, entry, changes.newestFirst());
    return { commit: { productKey: base.header.productKey, changed: true, entry, mode: "small" }, revisions };
  }
}

/**
 * Record products above the in-memory bound: each chunk of rows is classified
 * against the runner's SQLite entity index, which writes only what changed.
 */
/** Rows staged to the runner in one call, whichever bound is reached first. */
const STAGE_ROWS = 2_000;
/** What a staged row costs beyond its own strings: the frame around it. */
const STAGED_ROW_OVERHEAD = 128;

class LargeRecordWorker implements ProductWorker {
  private buffer: StagedRecord[] = [];
  /** What the buffered rows weigh, so a batch is bounded by bytes and not only by count. */
  private bufferBytes = 0;
  private seen = new Uint8Array(1024);
  private readonly changes = new RecentChanges<ChangeItem>(WINDOW.changes);
  private revisions = 0;
  private staged = 0;

  constructor(private readonly base: WorkerBase) {}

  async pushRecord(record: CanonicalRecord): Promise<void> {
    const prepared = prepareRecord(record);
    const json = prepared.removal ? null : servingJson(prepared, this.base.context);
    this.buffer.push({ prepared, json });
    // A staged row carries both the prepared record and the JSON it will be
    // served as, so it weighs about twice what it will be stored as.
    this.bufferBytes += (json === null ? 0 : utf8Length(json)) + utf8Length(prepared.hash) + prepared.key.length + STAGED_ROW_OVERHEAD;
    if (this.buffer.length >= STAGE_ROWS || this.bufferBytes >= STAGE_BYTES) await this.flush();
  }

  async pushPoint(): Promise<void> {
    throw new NormalizedInputError("A point was sent to a record product");
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const rows = this.buffer;
    this.buffer = [];
    this.bufferBytes = 0;
    const result = await this.base.ports.runner.stageRecords(this.base.plan.acquisitionId, this.base.header.productKey, rows);
    for (const id of result.seen) this.mark(id);
    this.changes.addAll([...result.changes].reverse());
    this.revisions += result.revisions;
    this.staged += result.staged;
  }

  private mark(id: number): void {
    const byte = id >> 3;
    if (byte >= this.seen.length) {
      const grown = new Uint8Array(Math.max(this.seen.length * 2, byte + 1));
      grown.set(this.seen);
      this.seen = grown;
    }
    this.seen[byte]! |= 1 << (id & 7);
  }

  async finish(rules: ProductRules): Promise<FinishedProduct> {
    await this.flush();
    const { base } = this;
    if (rules.replaceCurrent && base.declared.previous) {
      const sweep = await base.ports.runner.sweepRecords(base.plan.acquisitionId, base.header.productKey, this.seen, rules.retract);
      this.changes.addAll([...sweep.changes].reverse());
      this.revisions += sweep.revisions;
      this.staged += sweep.removed;
    }
    const probe = nextEntry(base, rules, true);
    const changed = this.revisions > 0 || this.staged > 0 || !base.declared.previous?.chunks || metadataChanged(base.declared.previous, probe);
    if (!changed) return { commit: { productKey: base.header.productKey, changed: false, entry: nextEntry(base, rules, false), mode: "large" }, revisions: this.revisions };
    const entry = nextEntry(base, rules, true);
    await writeChangeWindow(base, entry, this.changes.newestFirst());
    // The runner rebuilds the changed chunks from its index after the commit and fills in the chunk list.
    return {
      commit: { productKey: base.header.productKey, changed: true, entry, mode: "large", staged: this.staged > 0 || !base.declared.previous?.chunks },
      revisions: this.revisions,
    };
  }
}

/** Time-series products keep a bounded window of the newest points; corrections are revisions. */
class SeriesWorker implements ProductWorker {
  private previous: Map<string, PointItem> | undefined;
  private previousWindow: SeriesWindow | undefined;
  private floor: string | undefined;
  private readonly next = new Map<string, PointItem>();
  private readonly changes = new RecentChanges<PointChangeItem>(WINDOW.pointChanges);
  private revisions = 0;

  constructor(private readonly base: WorkerBase) {}

  private async load(): Promise<Map<string, PointItem>> {
    if (this.previous) return this.previous;
    const key = this.base.declared.previous?.seriesKey;
    this.previousWindow = key ? await this.base.ports.objects.read<SeriesWindow>(key) : undefined;
    this.previous = new Map((this.previousWindow?.points ?? []).map((point) => [`${point.seriesKey}|${point.eventTime}`, point]));
    for (const [id, point] of this.previous) this.next.set(id, point);
    this.floor = this.previousWindow?.points.at(-1)?.eventTime;
    return this.previous;
  }

  async pushRecord(): Promise<void> {
    throw new NormalizedInputError("A record was sent to a series product");
  }

  async pushPoint(point: SeriesPoint): Promise<void> {
    const previous = await this.load();
    const id = `${point.seriesKey}|${point.eventTime}`;
    const before = this.next.get(id) ?? previous.get(id);
    // Live snapshots may repeat deep history: keep bounded overlap; older walks are backfill's job.
    if (!before && this.floor && point.eventTime < this.floor) return;
    const changed =
      this.base.declared.baseline ||
      !before ||
      before.value !== point.value ||
      before.unit !== point.unit ||
      stableStringify(before.dimensions) !== stableStringify(point.dimensions);
    if (!changed) return;
    const item: PointItem = {
      seriesKey: point.seriesKey,
      eventTime: point.eventTime,
      value: point.value,
      unit: point.unit,
      dimensions: point.dimensions,
      observedAt: this.base.plan.observedAt,
    };
    const revision = revisionId(this.base.context, id, "");
    this.changes.add({ ...item, id: revision, ingestedAt: this.base.plan.observedAt, acquisitionId: this.base.plan.acquisitionId, previousValue: before?.value ?? null });
    this.revisions += 1;
    this.next.set(id, item);
    if (this.next.size > WINDOW.points * 3) this.trim();
    if (this.base.context.keepHistory) {
      await this.base.outbox.add("points", {
        batch_id: this.base.plan.acquisitionId,
        revision_id: revision,
        feed_id: this.base.plan.feed.id,
        product_slug: this.base.declared.slug,
        normalizer_id: this.base.context.normalizer.id,
        normalizer_version: this.base.context.normalizer.version,
        schema: {},
        series_key: point.seriesKey,
        event_time: point.eventTime,
        value: point.value,
        unit: point.unit,
        dimensions: point.dimensions,
        observed_at: this.base.plan.observedAt,
        acquisition_id: this.base.plan.acquisitionId,
      });
    }
  }

  private trim(): void {
    const kept = [...this.next.entries()].sort(([, a], [, b]) => b.eventTime.localeCompare(a.eventTime) || a.seriesKey.localeCompare(b.seriesKey)).slice(0, WINDOW.points);
    this.next.clear();
    for (const [id, point] of kept) this.next.set(id, point);
  }

  async finish(rules: ProductRules): Promise<FinishedProduct> {
    await this.load();
    const { base } = this;
    const probe = nextEntry(base, rules, true);
    const changed = this.revisions > 0 || !this.previousWindow || metadataChanged(base.declared.previous, probe);
    if (!changed) return { commit: { productKey: base.header.productKey, changed: false, entry: nextEntry(base, rules, false), mode: "series" }, revisions: this.revisions };
    const entry = nextEntry(base, rules, true);
    const points = [...this.next.values()].sort((a, b) => b.eventTime.localeCompare(a.eventTime) || a.seriesKey.localeCompare(b.seriesKey)).slice(0, WINDOW.points);
    const seriesKey = keys.series(base.plan.feed.id, entry.slug, entry.version);
    await base.ports.objects.write(seriesKey, { slug: entry.slug, updatedAt: base.plan.observedAt, points } satisfies SeriesWindow);
    entry.seriesKey = seriesKey;
    entry.rowCount = points.length;
    if (keepsChangeWindow(base) && (this.revisions > 0 || !entry.seriesChangesKey)) {
      const previous = base.declared.previous?.seriesChangesKey ? await base.ports.objects.read<SeriesChangesWindow>(base.declared.previous.seriesChangesKey) : undefined;
      const changesKey = keys.seriesChanges(base.plan.feed.id, entry.slug, entry.version);
      await base.ports.objects.write(changesKey, {
        slug: entry.slug,
        updatedAt: base.plan.observedAt,
        changes: [...this.changes.newestFirst(), ...(previous?.changes ?? [])].slice(0, WINDOW.pointChanges),
      } satisfies SeriesChangesWindow);
      entry.seriesChangesKey = changesKey;
    }
    return { commit: { productKey: base.header.productKey, changed: true, entry, mode: "series" }, revisions: this.revisions };
  }
}

/** Shared progress of one history slice across its products. */
class HistoryState {
  readonly floors: Record<string, string>;
  readonly seen: Record<string, string>;
  readonly cursor: { before: string; offset?: number; token?: string };
  points = 0;
  records = 0;

  constructor(plan: CollectionPlan) {
    if (plan.mode.kind !== "history") throw new Error("History state needs a history plan");
    this.floors = { ...plan.backfill?.floors };
    this.seen = { ...plan.backfill?.seen };
    this.cursor = plan.mode.cursor;
  }
}

/**
 * A history slice goes to the lake only and never touches current serving.
 * Rows at or after what live collection already covers are skipped unless they
 * are an overlap the walk has not seen, so a walk never duplicates live history.
 */
class HistoryWorker implements ProductWorker {
  private floor: string | undefined;
  private nextFloor: string | undefined;

  constructor(
    private readonly base: WorkerBase,
    private readonly state: HistoryState,
  ) {}

  private async currentFloor(): Promise<string> {
    if (this.floor !== undefined) return this.floor;
    const slug = this.base.declared.slug;
    let floor = this.state.floors[slug];
    const previous = this.base.declared.previous;
    if (!floor && previous?.seriesKey) floor = (await this.base.ports.objects.read<SeriesWindow>(previous.seriesKey))?.points.at(-1)?.eventTime;
    if (!floor && previous?.watermark) floor = previous.watermark;
    this.floor = floor ?? this.state.cursor.before;
    this.nextFloor = this.floor;
    return this.floor;
  }

  private beyondFloor(eventTime: string, floor: string): boolean {
    const continuing = this.state.cursor.offset !== undefined || this.state.cursor.token !== undefined;
    return continuing ? eventTime > floor : eventTime >= floor;
  }

  async pushPoint(point: SeriesPoint): Promise<void> {
    // A product whose history the policy does not keep has none to walk either.
    if (!keepsHistory(this.base.plan.policy, this.base.header.productKey)) return;
    const floor = await this.currentFloor();
    const logical = `p|${this.base.declared.slug}|${point.seriesKey}|${point.eventTime}`;
    const hash = digest(stableStringify({ value: point.value, unit: point.unit, dimensions: point.dimensions }));
    if (this.beyondFloor(point.eventTime, floor) && this.state.seen[logical] === undefined) return;
    if (this.state.seen[logical] === hash) return;
    this.state.seen[logical] = hash;
    this.state.points += 1;
    if (point.eventTime < (this.nextFloor ?? floor)) this.nextFloor = point.eventTime;
    const plan = this.base.plan;
    await this.base.outbox.add("points", {
      batch_id: plan.acquisitionId,
      revision_id: `rev_${digest(`${plan.acquisitionId}|${logical}`)}`,
      feed_id: plan.feed.id,
      product_slug: this.base.declared.slug,
      normalizer_id: this.base.context.normalizer.id,
      normalizer_version: this.base.context.normalizer.version,
      schema: {},
      series_key: point.seriesKey,
      event_time: point.eventTime,
      value: point.value,
      unit: point.unit,
      dimensions: point.dimensions,
      observed_at: plan.observedAt,
      acquisition_id: plan.acquisitionId,
    });
  }

  async pushRecord(record: CanonicalRecord): Promise<void> {
    if (!record.eventTime || !keepsHistory(this.base.plan.policy, this.base.header.productKey)) return;
    const floor = await this.currentFloor();
    const logical = `r|${this.base.declared.slug}|${record.entityKey}`;
    const hash = digest(
      stableStringify({
        operation: record.operation ?? "upsert",
        payload: record.payload,
        eventTime: record.eventTime,
        validFrom: record.validFrom ?? null,
        validTo: record.validTo ?? null,
      }),
    );
    if (this.beyondFloor(record.eventTime, floor) && this.state.seen[logical] === undefined) return;
    if (this.state.seen[logical] === hash) return;
    this.state.seen[logical] = hash;
    this.state.records += 1;
    if (record.eventTime < (this.nextFloor ?? floor)) this.nextFloor = record.eventTime;
    const plan = this.base.plan;
    const row: JsonObject = {
      batch_id: plan.acquisitionId,
      revision_id: `rev_${digest(`${plan.acquisitionId}|${logical}`)}`,
      feed_id: plan.feed.id,
      product_slug: this.base.declared.slug,
      product_version: 0,
      normalizer_id: this.base.context.normalizer.id,
      normalizer_version: this.base.context.normalizer.version,
      schema: {},
      entity_key: record.entityKey,
      operation: record.operation ?? "upsert",
      event_time: record.eventTime,
      observed_at: plan.observedAt,
      ingested_at: plan.observedAt,
      acquisition_id: plan.acquisitionId,
      payload: record.payload,
    };
    if (record.validFrom) row.valid_from = record.validFrom;
    if (record.validTo) row.valid_to = record.validTo;
    if (record.sourcePublishedAt) row.source_published_at = record.sourcePublishedAt;
    await this.base.outbox.add("records", row);
  }

  async finish(): Promise<FinishedProduct> {
    if (this.nextFloor) this.state.floors[this.base.declared.slug] = this.nextFloor;
    return { commit: undefined, revisions: 0 };
  }
}

function hashOf(json: string): string {
  return servedIdentity(json).hash;
}

/**
 * The source link the site shows is a Gatekeeper's word, so only a plain web address passes:
 * no other scheme (a `javascript:` link would run on the product page) and no credentials.
 */
export function openableUrl(value: string): string | undefined {
  if (!URL.canParse(value)) return undefined;
  const url = new URL(value);
  if (url.protocol !== "https:" && url.protocol !== "http:") return undefined;
  return url.username || url.password ? undefined : url.toString();
}
