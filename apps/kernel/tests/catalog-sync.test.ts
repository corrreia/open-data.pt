import type { CatalogFeed } from "@open-data-pt/contract";
import { describe, expect, it } from "vitest";
import {
  SYNC_BATCH,
  SYNC_CHECK_MS,
  VERSION_CHECK_MIN_MS,
  cadenceFloorOf,
  checkForVersion,
  syncStep,
  withCadenceFloor,
  type SyncFeed,
  type SyncPorts,
  type SyncProgress,
  type SyncState,
} from "../src/catalog-sync";

/** A catalog feed of library alpha (slugs starting with a) or beta, resolved as the Gatekeeper sends it. */
function feed(slug: string, title = slug): CatalogFeed {
  const library = slug[0] === "a" ? "alpha" : "beta";
  return {
    slug,
    publisher: "ine",
    library,
    title,
    description: "Fixture",
    licence: "cc-by-4.0",
    topics: ["economy"],
    resourceKey: `${library}:${library}:things:${slug}`,
    configHash: "0".repeat(64),
    eventTimed: false,
    policy: { cadenceSeconds: 3600, timeoutSeconds: 30, maxBytes: 1024, historyMode: "changes" },
    staleAfterSeconds: 3600,
  };
}

interface InstalledFeed extends SyncFeed {
  title: string;
  library: string;
}

/** A Registry in memory: what the sync installs, updates and retires, and its stored sync state. */
class FakeRegistry implements SyncPorts {
  catalog: CatalogFeed[] | undefined = [];
  version: string | undefined = "v1";
  readonly installed = new Map<string, InstalledFeed>();
  readonly applied: string[] = [];
  readonly retired: string[] = [];
  readonly failing = new Set<string>();
  state: SyncState | undefined;
  clock = 1_000_000;
  private nextId = 1;

  async readCatalog(): Promise<CatalogFeed[] | undefined> {
    return structuredClone(this.catalog);
  }
  async catalogVersion(): Promise<string | undefined> {
    return this.version;
  }
  feeds(): SyncFeed[] {
    return [...this.installed.values()];
  }

  async apply(listed: CatalogFeed): Promise<void> {
    if (this.failing.has(listed.slug)) throw new Error("install failed");
    this.applied.push(listed.slug);
    const id = this.installed.get(listed.slug)?.id ?? `feed_${this.nextId++}`;
    this.installed.set(listed.slug, { id, slug: listed.slug, library: listed.library, title: listed.title });
  }

  async retire(feedId: string): Promise<void> {
    this.retired.push(feedId);
    for (const [slug, feed] of this.installed) if (feed.id === feedId) this.installed.delete(slug);
  }

  load(): SyncState | undefined {
    return this.state === undefined ? undefined : structuredClone(this.state);
  }
  save(state: SyncState): void {
    this.state = structuredClone(state);
  }
  now(): number {
    return this.clock;
  }

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
  fake.catalog = ["a1", "a2", "a3", "a4", "a5", "a6", "b1", "b2", "b3"].map((slug) => feed(slug));
  return fake;
}

describe("catalog sync", () => {
  it("installs every catalog feed on a fresh Registry's first steps, at most four per step", async () => {
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

  it("keeps the catalog version each check read, and forgets it when a Gatekeeper cannot say", async () => {
    const fake = registry();
    await fake.drain();
    expect(fake.state?.catalogVersion).toBe("v1");
    fake.version = undefined;
    await fake.nextCheck();
    expect(fake.state).not.toHaveProperty("catalogVersion");
  });

  it("brings the next check forward when a runner hears a catalog the last check did not read", async () => {
    const fake = registry();
    await fake.drain();
    const settled = fake.load();
    // The version the last check read, or none heard at all: the schedule stands.
    expect(checkForVersion(settled, "v1", fake.clock)).toBeUndefined();
    expect(checkForVersion(settled, undefined, fake.clock)).toBeUndefined();

    // A release: the next step checks at once and installs what it added.
    fake.version = "v2";
    fake.catalog!.push(feed("b4"));
    fake.clock += 1_000;
    const forward = checkForVersion(settled, "v2", fake.clock);
    expect(forward).toMatchObject({ nextCheckAt: fake.clock, versionCheckAt: fake.clock });
    fake.save(forward!);
    const steps = await fake.drain();
    expect(steps[0]?.checked).toBe(true);
    expect(fake.installed.has("b4")).toBe(true);
    expect(fake.state?.catalogVersion).toBe("v2");
  });

  it("brings a check forward at most once a minute while a release rolls out", async () => {
    const fake = registry();
    await fake.drain();
    fake.clock += 1_000;
    const forward = checkForVersion(fake.load(), "v2", fake.clock)!;
    // The check ran, but reached an instance still on the old release.
    fake.save({ ...forward, nextCheckAt: fake.clock + SYNC_CHECK_MS, catalogVersion: "v1" });
    expect(checkForVersion(fake.load(), "v2", fake.clock + VERSION_CHECK_MIN_MS - 1)).toBeUndefined();
    expect(checkForVersion(fake.load(), "v2", fake.clock + VERSION_CHECK_MIN_MS)).toMatchObject({ nextCheckAt: fake.clock + VERSION_CHECK_MIN_MS });
  });

  it("leaves a check alone that is already due or under way", async () => {
    const fake = registry();
    expect(checkForVersion(undefined, "v2", fake.clock)).toBeUndefined();
    await syncStep(fake);
    expect(fake.state?.queue.length).toBeGreaterThan(0);
    expect(checkForVersion(fake.load(), "v2", fake.clock)).toBeUndefined();
  });

  it("applies nothing while the catalog stays the same, and a changed feed under its same feed ID", async () => {
    const fake = registry();
    await fake.drain();
    const id = fake.installed.get("a1")!.id;
    expect((await fake.nextCheck())[0]!.applied).toBe(0);
    const catalog = fake.catalog;
    if (catalog === undefined) throw new Error("the fixture Registry starts with a catalog");

    catalog[0] = feed("a1", "Renamed");
    await fake.nextCheck();
    expect(fake.applied).toEqual(["a1"]);
    expect(fake.installed.get("a1")).toMatchObject({ id, title: "Renamed" });

    // A release that changes how beta's feeds are read resolves them to another configuration.
    fake.catalog = catalog.map((listed) => (listed.library === "beta" ? { ...listed, configHash: "1".repeat(64) } : listed));
    await fake.nextCheck();
    expect(fake.applied).toEqual(["b1", "b2", "b3"]);
  });

  it("retires a feed the catalog no longer lists, and every feed of a library no longer carried", async () => {
    const fake = registry();
    await fake.drain();
    const a2 = fake.installed.get("a2")!.id;
    const beta = ["b1", "b2", "b3"].map((slug) => fake.installed.get(slug)!.id);

    fake.catalog = fake.catalog!.filter((listed) => listed.slug !== "a2");
    await fake.nextCheck();
    expect(fake.retired).toEqual([a2]);

    // Held or deleted, the library lists nothing: its feeds go.
    fake.catalog = fake.catalog.filter((listed) => listed.library !== "beta");
    await fake.nextCheck();
    expect(fake.retired).toEqual(beta);
    expect(fake.state!.hashes.b1).toBeUndefined();
  });

  it("never retires anything when the Gatekeeper did not answer, and asks again at the next check", async () => {
    const fake = registry();
    await fake.drain();
    const answered = fake.catalog;

    fake.catalog = undefined;
    const steps = await fake.nextCheck();
    expect(steps).toEqual([{ checked: false, applied: 0, retired: 0, failed: 0, pending: 0 }]);
    expect(fake.retired).toEqual([]);
    expect(fake.installed.size).toBe(9);
    expect(fake.state!.lastError).toMatch(/did not answer/);

    fake.catalog = answered;
    await fake.nextCheck();
    expect(fake.retired).toEqual([]);
    expect(fake.state!.lastError).toBeUndefined();
  });

  it("retries a failed operation at the next check and keeps going with the rest", async () => {
    const fake = registry();
    fake.failing.add("a2");
    const steps = await fake.drain();
    expect(steps.reduce((total, step) => total + step.failed, 0)).toBe(1);
    expect(fake.installed.size).toBe(8);
    expect(fake.state!.lastError).toMatch(/^a2: .*install failed/);
    fake.failing.clear();
    await fake.nextCheck();
    expect(fake.applied).toEqual(["a2"]);
    expect(fake.state!.lastError).toBeDefined();
    await fake.nextCheck();
    expect(fake.state!.lastError).toBeUndefined();
  });
});

describe("the cadence floor a local session puts under a feed", () => {
  it("slows a feed that runs more often than the floor, and moves its freshness window with it", () => {
    const listed = feed("a-live");
    const minutely = { ...listed, staleAfterSeconds: 180, policy: { ...listed.policy, cadenceSeconds: 60 } };

    const slowed = withCadenceFloor(minutely, 1800);

    expect(slowed.policy.cadenceSeconds).toBe(1800);
    expect(slowed.staleAfterSeconds).toBe(5400);
  });

  it("leaves a feed that is already slower alone, and never shortens its freshness window", () => {
    const listed = feed("a-daily");
    const daily = { ...listed, staleAfterSeconds: 172_800, policy: { ...listed.policy, cadenceSeconds: 86_400 } };

    expect(withCadenceFloor(daily, 1800)).toBe(daily);
  });

  it("is off without a floor, which is what a deployment has", () => {
    const listed = feed("a-one");

    expect(withCadenceFloor(listed, 0)).toBe(listed);
    expect(cadenceFloorOf(undefined)).toBe(0);
    expect(cadenceFloorOf("")).toBe(0);
    expect(cadenceFloorOf("-60")).toBe(0);
    expect(cadenceFloorOf("not a number")).toBe(0);
    expect(cadenceFloorOf("1800")).toBe(1800);
  });
});
