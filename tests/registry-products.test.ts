import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import type { ManifestChunk } from "../apps/kernel/src/chunks";
import type { ProductIndexEntry } from "../apps/kernel/src/feed-model";
import { RegistryStore } from "../apps/kernel/src/registry-store";
import { fixtureResolved } from "./kernel-harness";
import { sqliteStorage } from "./sqlite-storage";

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

async function registry() {
  const database = new DatabaseSync(":memory:");
  const store = new RegistryStore(sqliteStorage(database));
  store.migrate();
  store.upsertPolicy({
    id: "policy_1",
    name: "Fixture",
    version: 1,
    createdAt: "2026-09-10T00:00:00.000Z",
    collection: { cadenceSeconds: 60, timeoutSeconds: 30, maxBytes: 1024, historyMode: "changes" },
  });
  const resolved = await fixtureResolved();
  store.upsertFeed({
    id: "feed_1",
    slug: "things",
    title: "Things",
    description: "",
    library: "fixture",
    config: resolved.config,
    semantics: resolved.semantics,
    resolved,
    feedEpoch: "e",
    policyId: "policy_1",
    enabled: true,
    staleAfterSeconds: 60,
    dataset: "ine-consumer-price-index",
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
