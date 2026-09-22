import { DatabaseSync } from "node:sqlite";
import {
  bufferedTransform,
  collectNormalized,
  resolveFeed,
  type CanonicalRecord,
  type Completeness,
  type FeedKindDescription,
  type JsonObject,
  type ProductUpdateMode,
  type ResolvedFeed,
  type SeriesPoint,
  type SourceFetch,
  type StreamingTransform,
} from "@open-data-pt/gatekeeper";
import type { ChunkObject } from "../apps/kernel/src/chunks";
import { drainOutbox, runCollection, type EngineOutcome, type LakeSend, type RunnerPort } from "../apps/kernel/src/engine";
import type { Feed, FeedPolicy, ProductIndexEntry } from "../apps/kernel/src/feed-model";
import type { LakeTable } from "../apps/kernel/src/lake";
import { ObjectStore } from "../apps/kernel/src/object-store";
import type { SnapshotStore, StoredObject } from "../apps/kernel/src/ports";
import { RunnerCore } from "../apps/kernel/src/runner-core";
import { sqliteStorage } from "./sqlite-storage";

/** R2 in memory, counting what the cost model counts: writes and reads. */
export class MemorySnapshots implements SnapshotStore {
  readonly objects = new Map<string, Uint8Array>();
  readonly putKeys: string[] = [];
  reads = 0;
  failPuts = false;
  /** Scale runs keep only chunk sizes, so the test process measures the kernel, not the fake bucket. */
  constructor(private readonly keepChunkBodies = true) {}
  async putStream(objectKey: string, content: ReadableStream<Uint8Array> | Uint8Array): Promise<void> {
    if (this.failPuts) throw new Error("object write failed");
    this.putKeys.push(objectKey);
    const bytes = content instanceof Uint8Array ? content : new Uint8Array(await new Response(content).arrayBuffer());
    this.objects.set(objectKey, !this.keepChunkBodies && objectKey.includes("/chunks/") ? new Uint8Array(0) : bytes);
  }
  async get(objectKey: string): Promise<StoredObject | undefined> {
    this.reads += 1;
    const bytes = this.objects.get(objectKey);
    if (!bytes) return undefined;
    return { body: new Response(bytes).body! };
  }
  async delete(objectKeys: string[]): Promise<void> {
    for (const key of objectKeys) this.objects.delete(key);
  }
  chunkPuts(): string[] {
    return this.putKeys.filter((key) => key.includes("/chunks/"));
  }
}

/** What the fixture source returns on the next collection. */
export interface FixtureSource {
  records: CanonicalRecord[];
  points: SeriesPoint[];
  completeness: Completeness;
  rejected: number;
  updateMode: ProductUpdateMode;
  kind: "record" | "series";
  /** Stream rows lazily from this generator instead of `records` (scale runs). */
  generate?: () => Iterable<CanonicalRecord>;
  fetch?: () => Promise<SourceFetch>;
  finalCompleteness?: Completeness;
}

const KIND: FeedKindDescription = {
  kind: "things",
  title: "Things",
  description: "Fixture",
  semantics: { domainSubject: "reference", defaultProductRole: "reference" },
  history: {},
};

export async function fixtureResolved(): Promise<ResolvedFeed> {
  return resolveFeed({ feed: "things" }, { library: "fixture", kinds: [KIND], validate: (config) => config });
}

export function policy(overrides: Partial<FeedPolicy["collection"]> = {}): FeedPolicy {
  return {
    id: "policy_1",
    name: "Fixture",
    version: 1,
    createdAt: "2026-09-10T00:00:00.000Z",
    collection: {
      cadenceSeconds: 3600,
      timeoutSeconds: 120,
      maxBytes: 1024 * 1024,
      historyMode: "changes",
      maxRecords: 2_000_000,
      maxOutputBytes: 2 * 1024 * 1024 * 1024,
      ...overrides,
    },
  };
}

export function record(key: string, value: number | string, extra: JsonObject = {}): CanonicalRecord {
  return { entityKey: key, payload: { name: `Entity ${key}`, value, ...extra } };
}

export interface KernelHarness {
  core: RunnerCore;
  port: RunnerPort;
  snapshots: MemorySnapshots;
  objects: ObjectStore;
  source: FixtureSource;
  published: ProductIndexEntry[][];
  lake: Array<{ table: LakeTable; rows: JsonObject[] }>;
  failPublish: { next: boolean };
  clock: { now: number };
  collect(): Promise<EngineOutcome & { acquisitionId: string }>;
  /** Run one acquisition; with `lake`, the collection delivers its history itself, as the Workflow does. */
  run(acquisitionId: string, lake?: LakeSend): Promise<EngineOutcome>;
  deliver(): Promise<number>;
  lakeCount: number;
  lakeRows(table?: LakeTable): JsonObject[];
  served(slug?: string): Promise<JsonObject[]>;
  entry(slug?: string): ProductIndexEntry | undefined;
}

export interface HarnessOptions {
  policy?: FeedPolicy;
  keepChunkBodies?: boolean;
  keepLake?: boolean;
  /** Replace the fixture kind's history capability; null resolves a feed without history. */
  history?: ResolvedFeed["history"] | null;
}

export async function kernelHarness(options: HarnessOptions = {}): Promise<KernelHarness> {
  const database = new DatabaseSync(":memory:");
  const transaction = <T>(body: () => T): T => {
    database.exec("BEGIN");
    try {
      const value = body();
      database.exec("COMMIT");
      return value;
    } catch (error) {
      database.exec("ROLLBACK");
      throw error;
    }
  };
  // Deadlines are enforced against the real clock, so the fake one starts there and only moves forwards.
  const clock = { now: Date.now() };
  const snapshots = new MemorySnapshots(options.keepChunkBodies ?? true);
  const objects = new ObjectStore(snapshots);
  const published: ProductIndexEntry[][] = [];
  const failPublish = { next: false };
  const core = new RunnerCore(sqliteStorage(database), transaction, {
    objects,
    publish: async (entries) => {
      if (failPublish.next) {
        failPublish.next = false;
        throw new Error("Registry unavailable");
      }
      published.push(entries);
      return true;
    },
    claim: async () => undefined,
    lakeAvailable: true,
    now: () => clock.now,
  });
  core.migrate();
  const resolved = await fixtureResolved();
  if (options.history === null) delete resolved.history;
  else if (options.history) resolved.history = options.history;
  const feedPolicy = options.policy ?? policy();
  const feed: Feed = {
    id: "feed_1",
    slug: "things",
    title: "Things",
    description: "Fixture",
    library: "fixture",
    config: resolved.config,
    semantics: resolved.semantics,
    resolved,
    feedEpoch: "epoch-1",
    policyId: feedPolicy.id,
    enabled: true,
    staleAfterSeconds: 7200,
    dataset: "ine-consumer-price-index",
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  };
  core.configure(feed, feedPolicy);
  const source: FixtureSource = { records: [], points: [], completeness: "complete", rejected: 0, updateMode: "authoritative-snapshot", kind: "record" };
  const lake: Array<{ table: LakeTable; rows: JsonObject[] }> = [];
  const port: RunnerPort = {
    begin: async (id) => core.begin(id),
    declare: (id, input) => core.declare(id, input),
    promote: (key) => core.promote(key),
    stageRecords: async (id, key, rows) => core.stageRecords(id, key, rows),
    sweepRecords: async (id, key, seen, retract) => core.sweepRecords(id, key, seen, retract),
    appendOutbox: async (id, table, json, rows) => core.appendOutbox(id, table, json, rows),
    commit: (id, input) => core.commit(id, input),
    unchanged: async (id, checkpoint) => core.unchanged(id, checkpoint),
    historyExhausted: async (id) => core.historyExhausted(id),
    fail: async (id, failure) => core.fail(id, failure),
    pendingOutbox: async (limit) => core.pendingOutbox(limit),
    ackOutbox: async (seqs, next) => {
      core.ackOutbox(seqs);
      return core.pendingOutbox(next);
    },
  };
  const gatekeeper = {
    collect: (request: Parameters<typeof collectNormalized>[0]) =>
      collectNormalized(request, {
        normalizer: { id: "fixture", version: "1" },
        resolve: async () => resolved,
        source: async () =>
          source.fetch ? source.fetch() : { kind: "body", body: new Uint8Array(0), provenance: { sourceUrl: "https://example.test/things" }, completeness: source.completeness },
        normalize: { kind: "streaming", transform: async () => fixtureTransform(source) },
      }),
  };
  const run = (acquisitionId: string, lake?: LakeSend) => runCollection(acquisitionId, lake ? { runner: port, gatekeeper, objects, lake } : { runner: port, gatekeeper, objects });
  const harness: KernelHarness = {
    core,
    port,
    snapshots,
    objects,
    source,
    published,
    lake,
    failPublish,
    clock,
    async collect() {
      const acquisition = core.collectNow("manual");
      core.markStarted(acquisition.id, `${acquisition.id}-test`);
      const outcome = await run(acquisition.id);
      // As the Workflow does: deliver only when the collection says it committed history, and never leave any behind.
      if (outcome.historyRows > 0) await harness.deliver();
      if (core.committedOutboxRows() > 0) throw new Error(`Collection reported ${outcome.historyRows} history rows but left committed history undelivered`);
      clock.now += 60_000;
      return { ...outcome, acquisitionId: acquisition.id };
    },
    run,
    deliver: async () =>
      (
        await drainOutbox(
          port,
          async (table, rows) => {
            harness.lakeCount += rows.length;
            if (options.keepLake ?? true) lake.push({ table, rows });
          },
          Number.MAX_SAFE_INTEGER,
        )
      ).delivered,
    lakeCount: 0,
    lakeRows: (table) => lake.filter((batch) => table === undefined || batch.table === table).flatMap((batch) => batch.rows),
    entry: (slug = "things") => published.at(-1)?.find((entry) => entry.slug === slug),
    async served(slug = "things") {
      const rows: JsonObject[] = [];
      for (const chunk of harness.entry(slug)?.chunks ?? []) rows.push(...((await objects.read<ChunkObject>(chunk.key))?.rows ?? []));
      return rows;
    },
  };
  return harness;
}

function fixtureTransform(source: FixtureSource): StreamingTransform {
  const product =
    source.kind === "record"
      ? {
          productKey: "things",
          slug: "things",
          title: "Things",
          description: "Fixture things",
          role: "reference" as const,
          kind: "record" as const,
          schema: {
            fields: [
              { id: "name", name: "Name", type: "string" as const, nullable: false },
              { id: "value", name: "Value", type: "string" as const, nullable: true },
            ],
          },
          updateMode: source.updateMode,
          completeness: "complete" as const,
        }
      : {
          productKey: "readings",
          slug: "readings",
          title: "Readings",
          description: "Fixture series",
          role: "time-series" as const,
          kind: "series" as const,
          schema: { fields: [{ id: "value", name: "Value", type: "number" as const, nullable: false }] },
          updateMode: "source-window" as const,
          completeness: "complete" as const,
        };
  if (!source.generate) {
    const base = bufferedTransform({
      transformer: { id: "fixture", version: "1" },
      products:
        source.kind === "record" ? [{ ...product, kind: "record", records: source.records }] : [{ ...product, kind: "series", updateMode: "source-window", points: source.points }],
      quality: { acceptedRecords: source.records.length + source.points.length, rejectedRecords: source.rejected },
    });
    if (!source.finalCompleteness) return base;
    const completeness = source.finalCompleteness;
    return { ...base, finish: () => ({ ...base.finish(), products: [{ productKey: product.productKey, completeness }] }) };
  }
  const generate = source.generate;
  let accepted = 0;
  return {
    products: [product],
    rows: (async function* () {
      for (const value of generate()) {
        accepted += 1;
        yield { productKey: "things", record: value };
      }
    })(),
    finish: () => ({ quality: { acceptedRecords: accepted, rejectedRecords: source.rejected } }),
  };
}
