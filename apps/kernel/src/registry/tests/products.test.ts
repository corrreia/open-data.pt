import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { ManifestChunk } from "#/serving/chunks";
import type { ProductIndexEntry } from "#/registry/feed-model";
import { RegistryStore } from "#/registry/store";
import { fixtureResolved } from "#/tests/kernel-harness";
import { runnerPublicationId, type RunnerPublication } from "#/durability/runner-snapshot";
import { sqliteStorage } from "#/tests/sqlite-storage";

function entry(slug: string, kind: "record" | "series", chunks: ManifestChunk[] | null): ProductIndexEntry {
  return {
    id: `prd_${slug}`,
    slug,
    feedId: "feed_1",
    productKey: slug,
    title: slug,
    description: "",
    role: kind === "series" ? "time-series" : "reference",
    kind,
    schema: { fields: [] },
    updateMode: "authoritative-snapshot",
    completeness: "complete",
    version: 1,
    status: "current",
    currentAcquisitionId: "acq_1",
    watermark: null,
    rowCount: 2,
    chunks,
    changesKey: null,
    seriesKey: null,
    seriesChangesKey: null,
    updatedAt: "2026-09-11T00:00:00.000Z",
    createdAt: "2026-09-11T00:00:00.000Z",
  };
}

function publication(number: number, entries: ProductIndexEntry[], acquisitionId = `acq_${number}`): RunnerPublication {
  return {
    id: runnerPublicationId("feed_1", number, acquisitionId),
    number,
    feedId: "feed_1",
    acquisitionId,
    entries,
    supersededObjectKeys: [],
  };
}

async function registry() {
  const database = new DatabaseSync(":memory:");
  const store = new RegistryStore(sqliteStorage(database));
  store.migrate();
  const resolved = await fixtureResolved();
  store.upsertFeed({
    id: "feed_1",
    slug: "things",
    title: "Things",
    description: "",
    library: "fixture",
    format: "own-api",
    resourceKey: resolved.resourceKey,
    configHash: resolved.configHash,
    eventTimed: false,
    policy: { cadenceSeconds: 60, timeoutSeconds: 30, maxBytes: 1024, historyMode: "changes" },
    feedEpoch: "e",
    enabled: true,
    staleAfterSeconds: 60,
    publisher: "ine",
    licence: "cc-by-4.0",
    topics: ["economy"],
    createdAt: "2026-09-10T00:00:00.000Z",
    updatedAt: "2026-09-10T00:00:00.000Z",
  });
  return { database, store };
}

describe("the Registry's product index", () => {
  it("returns a record product's chunk list for a single read and never in a list", async () => {
    const { store } = await registry();
    const chunks: ManifestChunk[] = [{ key: "serving/feed_1/things/chunks/a.json", rows: 2, first: "a", last: "b" }];
    store.replaceFeedProducts("feed_1", [entry("things", "record", chunks), entry("readings", "series", null)]);
    expect(store.listProducts().map((product) => product.slug)).toEqual(["readings", "things"]);
    for (const product of store.listProducts()) expect(product).not.toHaveProperty("chunks");
    expect(store.getProductBySlug("things")?.chunks).toEqual(chunks);
    expect(store.getProductBySlug("readings")?.chunks).toBeNull();
  });

  it("returns the original durable receipt after a lost reply without selecting the same publication again", async () => {
    const { database, store } = await registry();
    const selectedAt = "2026-09-11T01:00:00.000Z";
    const sent = publication(1, [entry("things", "record", null)]);
    const first = store.acceptPublication(sent, selectedAt, 1);
    const changes = () => Number(database.prepare("SELECT total_changes() AS n").get()?.n ?? 0);
    const before = changes();

    const retry = store.acceptPublication(sent, "2026-09-11T03:00:00.000Z", 1);

    expect(retry).toEqual(first);
    expect(retry).toMatchObject({ acceptedPublicationId: sent.id, acceptedThrough: 1, selectedAt });
    expect(changes() - before).toBe(0);
  });

  it("lets a newer receipt cover an older retry without reselecting the older entries", async () => {
    const { database, store } = await registry();
    const older = entry("things", "record", [{ key: "old.json", rows: 1, first: "a", last: "a" }]);
    const newer = { ...entry("things", "record", [{ key: "new.json", rows: 1, first: "a", last: "a" }]), version: 2 };
    const first = publication(1, [older]);
    const second = publication(2, [newer]);
    store.acceptPublication(first, "2026-09-11T01:00:00.000Z", 1);
    const latest = store.acceptPublication(second, "2026-09-11T02:00:00.000Z", 1);

    expect(store.acceptPublication(first, "2026-09-11T03:00:00.000Z", 1)).toEqual(latest);
    expect(store.getProductBySlug("things")?.version).toBe(2);
    expect(store.getProductBySlug("things")?.chunks?.[0]?.key).toBe("new.json");
    expect(database.prepare("SELECT COUNT(*) AS count FROM accepted_publications WHERE feed_id = 'feed_1'").get()).toEqual({ count: 1 });
  });

  it("writes nothing when a feed republishes the same products, and the new chunk list when one changes", async () => {
    const { database, store } = await registry();
    const first: ManifestChunk = { key: "serving/feed_1/things/chunks/a.json", rows: 2, first: "a", last: "b" };
    const products = [entry("things", "record", [first]), entry("readings", "series", null)];
    store.replaceFeedProducts("feed_1", products);
    const changes = () => Number(database.prepare("SELECT total_changes() AS n").get()?.n ?? 0);
    const before = changes();
    store.replaceFeedProducts("feed_1", products);
    expect(changes() - before).toBe(0);
    const second: ManifestChunk = { key: "serving/feed_1/things/chunks/c.json", rows: 1, first: "c", last: "c" };
    store.replaceFeedProducts("feed_1", [entry("things", "record", [first, second]), entry("readings", "series", null)]);
    expect(store.getProductBySlug("things")?.chunks).toEqual([first, second]);
  });
});
