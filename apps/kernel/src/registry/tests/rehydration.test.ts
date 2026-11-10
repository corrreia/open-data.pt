import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { runnerPublicationId, type RunnerSnapshot } from "#/durability/runner-snapshot";
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

describe("Registry product rehydration", () => {
  it("restores a fresh Registry from an unchanged runner without waiting for another source collection", async () => {
    const runner = await kernelHarness();
    runner.source.records = [record("a", 1)];
    await runner.collect();
    const snapshot = await runner.core.registrySnapshot();

    const database = new DatabaseSync(":memory:");
    const tx = transaction(database);
    const store = new RegistryStore(sqliteStorage(database), tx);
    store.migrate();
    store.upsertFeed(snapshot.feed);
    expect(store.rehydrationRequired()).toBe(true);
    expect(store.listProducts()).toEqual([]);

    await rehydrateRegistryProducts(store, tx, [snapshot.feed.id], async () => snapshot, "2026-09-10T02:00:00.000Z");

    expect(store.rehydrationRequired()).toBe(false);
    expect(store.getProductBySlug("things")).toEqual(snapshot.products[0]);
    expect(store.getFeed(snapshot.feed.id)).toMatchObject(snapshot.status);
    expect(store.listActivity(10).map((acquisition) => acquisition.id)).toEqual(snapshot.recentAcquisitions.map((acquisition) => acquisition.id));
  });

  it("keeps the previous complete index visible until every runner answers, then makes identical repeats read-only", async () => {
    const runner = await kernelHarness();
    runner.source.records = [record("a", 1)];
    await runner.collect();
    const source = await runner.core.registrySnapshot();
    const firstFeed = renameFeed(source.feed, "feed_a");
    const secondFeed = renameFeed(source.feed, "feed_b");
    const firstEntry = renameEntry(source.products[0]!, firstFeed.id, "alpha");
    const secondEntry = renameEntry(source.products[0]!, secondFeed.id, "beta");
    const first = snapshotFor(firstFeed, [firstEntry], source);
    const second = snapshotFor(secondFeed, [secondEntry], source);

    const database = new DatabaseSync(":memory:");
    const tx = transaction(database);
    const store = new RegistryStore(sqliteStorage(database), tx);
    store.migrate();
    store.upsertFeed(firstFeed);
    store.upsertFeed(secondFeed);
    const oldFirst = renameEntry(firstEntry, firstFeed.id, "old-alpha");
    const oldSecond = renameEntry(secondEntry, secondFeed.id, "old-beta");
    store.replaceFeedProducts(firstFeed.id, [oldFirst]);
    store.replaceFeedProducts(secondFeed.id, [oldSecond]);

    let answerSecond: (snapshot: RunnerSnapshot) => void = () => undefined;
    const delayed = new Promise<RunnerSnapshot>((resolve) => {
      answerSecond = resolve;
    });
    const rehydrating = rehydrateRegistryProducts(
      store,
      tx,
      [firstFeed.id, secondFeed.id],
      (feedId) => (feedId === firstFeed.id ? Promise.resolve(first) : delayed),
      "2026-09-10T02:00:00.000Z",
    );
    await Promise.resolve();
    expect(store.listProducts().map((product) => product.slug)).toEqual(["old-alpha", "old-beta"]);

    answerSecond(second);
    expect(await rehydrating).toBe(true);
    expect(store.listProducts().map((product) => product.slug)).toEqual(["alpha", "beta"]);

    const changes = () => Number(database.prepare("SELECT total_changes() AS count").get()?.count ?? 0);
    const before = changes();
    expect(
      await rehydrateRegistryProducts(store, tx, [firstFeed.id, secondFeed.id], async (feedId) => (feedId === firstFeed.id ? first : second), "2026-09-10T03:00:00.000Z"),
    ).toBe(false);
    expect(changes() - before).toBe(0);
    expect(store.listProducts().map((product) => product.slug)).toEqual(["alpha", "beta"]);
  });
});
