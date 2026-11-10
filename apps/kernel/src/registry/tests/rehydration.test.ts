import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runnerPublicationId, type RunnerSnapshot } from "#/durability/runner-snapshot";
import { SYNC_BATCH } from "#/registry/catalog-sync";
import type { Feed, ProductIndexEntry } from "#/registry/feed-model";
import { RegistryStore, rehydrateRegistryProducts } from "#/registry/store";
import { kernelHarness, record } from "#/tests/kernel-harness";
import { sqliteStorage } from "#/tests/sqlite-storage";

function transaction(database: DatabaseSync) {
  return <T>(body: () => T): T => {
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
}

function renameFeed(feed: Feed, id: string): Feed {
  return { ...feed, id, slug: id, title: id };
}

function renameEntry(entry: ProductIndexEntry, feedId: string, slug: string): ProductIndexEntry {
  return { ...entry, id: `prd_${slug}`, feedId, slug, productKey: slug, title: slug };
}

function snapshotFor(feed: Feed, products: ProductIndexEntry[], source: RunnerSnapshot): RunnerSnapshot {
  return {
    feed,
    products,
    status: source.status,
    recentAcquisitions: source.recentAcquisitions.map((acquisition) => ({ ...acquisition, feedId: feed.id })),
    publication: { id: runnerPublicationId(feed.id, products), acquisitionId: source.publication.acquisitionId },
  };
}

async function setup(count: number, oldProducts = false) {
  const runner = await kernelHarness();
  runner.source.records = [record("a", 1)];
  await runner.collect();
  const source = await runner.core.registrySnapshot();
  const snapshots = Array.from({ length: count }, (_, index) => {
    const suffix = String(index).padStart(2, "0");
    const feed = renameFeed(source.feed, `feed_${suffix}`);
    return snapshotFor(feed, [renameEntry(source.products[0]!, feed.id, `product-${suffix}`)], source);
  });

  const database = new DatabaseSync(":memory:");
  const tx = transaction(database);
  const store = new RegistryStore(sqliteStorage(database), tx);
  store.migrate();
  for (const snapshot of snapshots) {
    store.upsertFeed(snapshot.feed);
    if (oldProducts) store.replaceFeedProducts(snapshot.feed.id, [renameEntry(snapshot.products[0]!, snapshot.feed.id, `old-${snapshot.feed.id.slice("feed_".length)}`)]);
  }
  return { database, tx, store, snapshots };
}

function answerFrom(snapshots: RunnerSnapshot[], requests: string[] = []) {
  const byFeed = new Map(snapshots.map((snapshot) => [snapshot.feed.id, snapshot]));
  return async (feedId: string): Promise<RunnerSnapshot> => {
    requests.push(feedId);
    const snapshot = byFeed.get(feedId);
    if (!snapshot) throw new Error(`Unknown fixture feed ${feedId}`);
    return snapshot;
  };
}

function count(database: DatabaseSync, table: string): number {
  return Number(database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get()?.count ?? 0);
}

describe("Registry product rehydration", () => {
  it("restores a fresh Registry from an unchanged runner without waiting for another source collection", async () => {
    const { store, snapshots } = await setup(1);
    const snapshot = snapshots[0]!;
    expect(store.rehydrationRequired()).toBe(true);
    expect(store.listProducts()).toEqual([]);

    const step = await rehydrateRegistryProducts(store, answerFrom(snapshots), "2026-09-10T02:00:00.000Z");

    expect(step).toEqual({ requested: 1, complete: true, changed: true });
    expect(store.rehydrationRequired()).toBe(false);
    expect(store.getProductBySlug("product-00")).toEqual(snapshot.products[0]);
    expect(store.getFeed(snapshot.feed.id)).toMatchObject(snapshot.status);
    expect(store.listActivity(10).map((acquisition) => acquisition.id)).toEqual(snapshot.recentAcquisitions.map((acquisition) => acquisition.id));
  });

  it("requests no more than one sync batch and keeps the old complete index visible after the first batch", async () => {
    const { store, snapshots } = await setup(SYNC_BATCH * 2 + 1, true);
    const requests: string[] = [];
    const oldSlugs = store.listProducts().map((product) => product.slug);

    const step = await rehydrateRegistryProducts(store, answerFrom(snapshots, requests), "2026-09-10T02:00:00.000Z", SYNC_BATCH * 10);

    expect(step).toEqual({ requested: SYNC_BATCH, complete: false, changed: false });
    expect(requests).toHaveLength(SYNC_BATCH);
    expect(store.listProducts().map((product) => product.slug)).toEqual(oldSlugs);
  });

  it("preserves active products after a middle-batch failure and resumes at the failed feed", async () => {
    const { store, snapshots } = await setup(SYNC_BATCH * 2 + 2, true);
    const answer = answerFrom(snapshots);
    const oldSlugs = store.listProducts().map((product) => product.slug);
    await rehydrateRegistryProducts(store, answer, "2026-09-10T02:00:00.000Z");

    const failedFeed = snapshots[SYNC_BATCH + 1]!.feed.id;
    const secondRequests: string[] = [];
    await expect(
      rehydrateRegistryProducts(
        store,
        async (feedId) => {
          secondRequests.push(feedId);
          if (feedId === failedFeed) throw new Error("runner unavailable");
          return answer(feedId);
        },
        "2026-09-10T02:01:00.000Z",
      ),
    ).rejects.toThrow("runner unavailable");
    expect(secondRequests).toEqual([snapshots[SYNC_BATCH]!.feed.id, failedFeed]);
    expect(store.listProducts().map((product) => product.slug)).toEqual(oldSlugs);

    const resumed: string[] = [];
    await rehydrateRegistryProducts(store, answerFrom(snapshots, resumed), "2026-09-10T02:02:00.000Z");
    expect(resumed[0]).toBe(failedFeed);
    expect(resumed).not.toContain(snapshots[SYNC_BATCH]!.feed.id);
    expect(store.listProducts().map((product) => product.slug)).toEqual(oldSlugs);

    await rehydrateRegistryProducts(store, answer, "2026-09-10T02:03:00.000Z");
    expect(store.listProducts().map((product) => product.slug)).toEqual(snapshots.map((snapshot) => snapshot.products[0]!.slug));
  });

  it("resumes persisted progress after RegistryStore eviction", async () => {
    const { database, tx, store, snapshots } = await setup(SYNC_BATCH + 1);
    const firstRequests: string[] = [];
    await rehydrateRegistryProducts(store, answerFrom(snapshots, firstRequests), "2026-09-10T02:00:00.000Z");
    expect(firstRequests).toHaveLength(SYNC_BATCH);

    const resumedStore = new RegistryStore(sqliteStorage(database), tx);
    resumedStore.migrate();
    const resumedRequests: string[] = [];
    const final = await rehydrateRegistryProducts(resumedStore, answerFrom(snapshots, resumedRequests), "2026-09-10T02:01:00.000Z");

    expect(resumedRequests).toEqual([snapshots.at(-1)!.feed.id]);
    expect(final).toEqual({ requested: 1, complete: true, changed: true });
    expect(resumedStore.listProducts()).toHaveLength(snapshots.length);
  });

  it("atomically exposes the complete shadow and clears all rehydration tables on the final step", async () => {
    const { database, store, snapshots } = await setup(SYNC_BATCH + 1);
    const answer = answerFrom(snapshots);

    await rehydrateRegistryProducts(store, answer, "2026-09-10T02:00:00.000Z");
    expect(store.listProducts()).toEqual([]);
    expect(count(database, "rehydration_products")).toBe(SYNC_BATCH);
    expect(count(database, "rehydration_claims")).toBe(SYNC_BATCH);
    expect(count(database, "rehydration_progress")).toBe(snapshots.length);

    const final = await rehydrateRegistryProducts(store, answer, "2026-09-10T02:01:00.000Z");

    expect(final).toEqual({ requested: 1, complete: true, changed: true });
    expect(store.listProducts().map((product) => product.slug)).toEqual(snapshots.map((snapshot) => snapshot.products[0]!.slug));
    expect(count(database, "products")).toBe(snapshots.length);
    expect(count(database, "claims")).toBe(snapshots.length);
    expect(count(database, "rehydration_products")).toBe(0);
    expect(count(database, "rehydration_claims")).toBe(0);
    expect(count(database, "rehydration_progress")).toBe(0);
    expect(store.rehydrationRequired()).toBe(false);
  });

  it("makes a repeated final step read-only", async () => {
    const { database, store, snapshots } = await setup(1);
    const answer = answerFrom(snapshots);
    await rehydrateRegistryProducts(store, answer, "2026-09-10T02:00:00.000Z");
    const changes = () => Number(database.prepare("SELECT total_changes() AS count").get()?.count ?? 0);
    const before = changes();
    const requests: string[] = [];

    const repeated = await rehydrateRegistryProducts(store, answerFrom(snapshots, requests), "2026-09-10T03:00:00.000Z");

    expect(repeated).toEqual({ requested: 0, complete: true, changed: false });
    expect(requests).toEqual([]);
    expect(changes() - before).toBe(0);
  });
});
