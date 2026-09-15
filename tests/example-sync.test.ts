import type { ExampleFeed, FeedKindDescription } from "@open-data-pt/gatekeeper-shared";
import { describe, expect, it } from "vitest";
import { SYNC_BATCH, SYNC_CHECK_MS, SYNC_RESOLVE_ALL_MS, syncStep, type CatalogEntry, type SyncFeed, type SyncPorts, type SyncProgress, type SyncState } from "../apps/kernel/src/example-sync";

function example(slug: string, title = slug): ExampleFeed {
  return {
    slug, title, description: "Fixture", config: { feed: slug }, staleAfterSeconds: 3600,
    policy: { name: "Fixture", version: 1, collection: { cadenceSeconds: 3600, timeoutSeconds: 30, maxBytes: 1024, historyMode: "changes" }, serving: {} },
  };
}

function kind(name: string, title = name): FeedKindDescription {
  return {
    kind: name, title, description: "Fixture",
    semantics: { boundedness: "bounded", changeSemantics: "full-snapshot", cadence: "periodic", domainSubject: "reference", defaultProductRole: "reference", completeness: "complete", ordering: "none" },
  };
}

interface InstalledFeed extends SyncFeed {
  title: string;
}

/** A Registry in memory: what the sync installs, updates and retires, and its stored sync state. */
class FakeRegistry implements SyncPorts {
  catalog: CatalogEntry[] = [];
  bound: string[] = [];
  readonly installed = new Map<string, InstalledFeed>();
  readonly applied: string[] = [];
  readonly retired: string[] = [];
  readonly failing = new Set<string>();
  state: SyncState | undefined;
  clock = 1_000_000;
  private nextId = 1;

  boundKinds(): string[] { return this.bound; }
  async readCatalog(): Promise<CatalogEntry[]> { return structuredClone(this.catalog); }
  feeds(): SyncFeed[] { return [...this.installed.values()]; }

  async apply(gatekeeperKind: string, feed: ExampleFeed): Promise<void> {
    if (this.failing.has(feed.slug)) throw new Error("resolution failed");
    this.applied.push(feed.slug);
    const id = this.installed.get(feed.slug)?.id ?? `feed_${this.nextId++}`;
    this.installed.set(feed.slug, { id, slug: feed.slug, gatekeeperKind, title: feed.title });
  }

  async retire(feedId: string): Promise<void> {
    this.retired.push(feedId);
    for (const [slug, feed] of this.installed) if (feed.id === feedId) this.installed.delete(slug);
  }

  load(): SyncState | undefined { return this.state === undefined ? undefined : structuredClone(this.state); }
  save(state: SyncState): void { this.state = structuredClone(state); }
  now(): number { return this.clock; }

  /** Run steps the way the Registry alarm does: again at once while operations are queued. */
  async drain(check = false): Promise<SyncProgress[]> {
    const steps = [await syncStep(this, { check })];
    while (steps.at(-1)!.pending > 0) steps.push(await syncStep(this));
    return steps;
  }

  /** The next scheduled check, fifteen minutes on. */
  async nextCheck(): Promise<SyncProgress[]> {
    this.clock += SYNC_CHECK_MS;
    this.applied.length = 0;
    this.retired.length = 0;
    return this.drain();
  }
}

function registry(): FakeRegistry {
  const fake = new FakeRegistry();
  fake.bound = ["alpha", "beta"];
  fake.catalog = [
    { kind: "alpha", kinds: [kind("alpha-things")], examples: ["a1", "a2", "a3", "a4", "a5", "a6"].map((slug) => example(slug)) },
    { kind: "beta", kinds: [kind("beta-things")], examples: ["b1", "b2", "b3"].map((slug) => example(slug)) },
  ];
  return fake;
}

describe("example sync", () => {
  it("installs every example on a fresh Registry's first steps, at most four per step", async () => {
    const fake = registry();
    const steps = await fake.drain();
    expect(SYNC_BATCH).toBe(4);
    expect(steps.map((step) => step.applied)).toEqual([4, 4, 1]);
    expect(steps.map((step) => step.pending)).toEqual([5, 1, 0]);
    expect(steps.map((step) => step.checked)).toEqual([true, false, false]);
    expect([...fake.installed.keys()].sort()).toEqual(["a1", "a2", "a3", "a4", "a5", "a6", "b1", "b2", "b3"]);
  });

  it("checks only every fifteen minutes unless asked", async () => {
    const fake = registry();
    await fake.drain();
    expect((await syncStep(fake)).checked).toBe(false);
    expect((await syncStep(fake, { check: true })).checked).toBe(true);
    fake.clock += SYNC_CHECK_MS;
    expect((await syncStep(fake)).checked).toBe(true);
  });

  it("updates a changed example under the same feed ID, and every example of a Gatekeeper whose feed kinds changed", async () => {
    const fake = registry();
    await fake.drain();
    const id = fake.installed.get("a1")!.id;
    expect((await fake.nextCheck())[0]!.applied).toBe(0);

    fake.catalog[0]!.examples[0] = example("a1", "Renamed");
    await fake.nextCheck();
    expect(fake.applied).toEqual(["a1"]);
    expect(fake.installed.get("a1")).toMatchObject({ id, title: "Renamed" });

    fake.catalog[1]!.kinds = [kind("beta-things", "Beta things, new semantics")];
    await fake.nextCheck();
    expect(fake.applied).toEqual(["b1", "b2", "b3"]);
  });

  it("retires a feed whose example disappeared, but never the feeds of a Gatekeeper that did not answer", async () => {
    const fake = registry();
    await fake.drain();
    const a2 = fake.installed.get("a2")!.id;
    const beta = ["b1", "b2", "b3"].map((slug) => fake.installed.get(slug)!.id);

    fake.catalog[0]!.examples.splice(1, 1);
    fake.catalog.splice(1, 1);
    await fake.nextCheck();
    expect(fake.retired).toEqual([a2]);
    expect(fake.installed.has("b1")).toBe(true);

    // Answering with no examples at all is a broken Gatekeeper, not an emptied one.
    fake.catalog.push({ kind: "beta", kinds: [kind("beta-things")], examples: [] });
    await fake.nextCheck();
    expect(fake.retired).toEqual([]);

    // Unbound from the kernel: its feeds go.
    fake.bound = ["alpha"];
    fake.catalog.splice(1, 1);
    await fake.nextCheck();
    expect(fake.retired).toEqual(beta);
    expect(fake.state!.hashes.b1).toBeUndefined();
  });

  it("applies every example again once a day, so each feed is resolved and handed to its runner daily", async () => {
    const fake = registry();
    await fake.drain();
    fake.clock += SYNC_RESOLVE_ALL_MS - SYNC_CHECK_MS;
    await fake.nextCheck();
    expect(fake.applied).toHaveLength(9);
    await fake.nextCheck();
    expect(fake.applied).toHaveLength(0);
  });

  it("retries a failed operation at the next check and keeps going with the rest", async () => {
    const fake = registry();
    fake.failing.add("a2");
    const steps = await fake.drain();
    expect(steps.reduce((total, step) => total + step.failed, 0)).toBe(1);
    expect(fake.installed.size).toBe(8);
    expect(fake.state!.lastError).toMatch(/^a2: .*resolution failed/);
    fake.failing.clear();
    await fake.nextCheck();
    expect(fake.applied).toEqual(["a2"]);
    expect(fake.state!.lastError).toBeDefined();
    await fake.nextCheck();
    expect(fake.state!.lastError).toBeUndefined();
  });
});
