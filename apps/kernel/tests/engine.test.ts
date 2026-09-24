import { describe, expect, it } from "vitest";
import { PromotionRequired, collectionStep, openableUrl, type CollectingGatekeeper } from "../src/engine";
import { MAX_RECORD_BYTES, STAGE_BYTES } from "../src/blob-budget";
import { BACKFILL_START_DELAY_MS, SMALL_PRODUCT_ROWS } from "../src/runner-core";
import { kernelHarness, policy, record, type KernelHarness } from "./kernel-harness";

function rows(count: number, value: (index: number) => number | string = (index) => index): ReturnType<typeof record>[] {
  return Array.from({ length: count }, (_, index) => record(`k${String(index).padStart(6, "0")}`, value(index)));
}

async function baseline(h: KernelHarness, count: number): Promise<void> {
  h.source.records = rows(count);
  expect((await h.collect()).status).toBe("succeeded");
}

describe("collection engine: current state", () => {
  it("publishes a new product as a baseline and never rewrites or re-sends an unchanged snapshot", async () => {
    const h = await kernelHarness();
    await baseline(h, 3);
    expect(h.entry()).toMatchObject({ version: 1, rowCount: 3, completeness: "complete" });
    // The chunk list travels on the product entry; no manifest object is ever written.
    expect(h.entry()?.chunks).toHaveLength(1);
    expect(h.snapshots.putKeys.some((key) => key.includes("/manifests/"))).toBe(false);
    expect((await h.served()).map((row) => row.id)).toEqual(["k000000", "k000001", "k000002"]);
    expect(h.lakeRows("records").map((row) => row.operation)).toEqual(["baseline", "baseline", "baseline"]);
    expect(h.lakeRows("records").every((row) => JSON.stringify(row.schema) === "{}")).toBe(true);
    const puts = h.snapshots.putKeys.length;
    const publications = h.published.length;
    const second = await h.collect();
    expect(second).toMatchObject({ status: "unchanged", revisions: 0 });
    expect(h.snapshots.putKeys.length).toBe(puts);
    expect(h.published.length).toBe(publications);
    expect(h.lakeRows()).toHaveLength(3);
  });

  it("turns one changed record among a thousand into one revision and one rewritten chunk", async () => {
    const h = await kernelHarness();
    await baseline(h, 1000);
    const chunksBefore = h.snapshots.chunkPuts().length;
    h.source.records = rows(1000, (index) => (index === 500 ? "changed" : index));
    const outcome = await h.collect();
    expect(outcome).toMatchObject({ status: "succeeded", revisions: 1 });
    const revisions = h.lakeRows("records").slice(1000);
    expect(revisions).toHaveLength(1);
    expect(revisions[0]).toMatchObject({ entity_key: "k000500", operation: "upsert", product_version: 2 });
    expect(h.snapshots.chunkPuts().length - chunksBefore).toBe(1);
    const served = await h.served();
    expect(served).toHaveLength(1000);
    expect(served.find((row) => row.id === "k000500")?.value).toBe("changed");
  });

  it("keeps the first-observed time on unchanged rows, so their chunks stay byte-identical", async () => {
    const h = await kernelHarness();
    await baseline(h, 5);
    const before = await h.served();
    h.source.records = rows(5, (index) => (index === 4 ? "new" : index));
    await h.collect();
    const after = await h.served();
    expect(after[0]).toEqual(before[0]);
    expect(after[4]?._time).not.toEqual(before[4]?._time);
  });

  it("ignores input order and records A→B→A as two revisions", async () => {
    const h = await kernelHarness();
    await baseline(h, 10);
    h.source.records = rows(10).reverse();
    expect((await h.collect()).status).toBe("unchanged");
    h.source.records = rows(10, (index) => (index === 3 ? "B" : index));
    expect((await h.collect()).revisions).toBe(1);
    h.source.records = rows(10);
    expect((await h.collect()).revisions).toBe(1);
    expect(
      h
        .lakeRows("records")
        .slice(10)
        .map((row) => row.entity_key),
    ).toEqual(["k000003", "k000003"]);
  });

  it("retracts entities missing from a complete authoritative snapshot, but not from a partial one", async () => {
    const h = await kernelHarness();
    await baseline(h, 4);
    h.source.records = rows(4).slice(0, 3);
    h.source.rejected = 1;
    expect((await h.collect()).revisions).toBe(0);
    expect(await h.served()).toHaveLength(4);
    expect(h.entry()?.completeness).toBe("partial");
    h.source.rejected = 0;
    const outcome = await h.collect();
    expect(outcome.revisions).toBe(1);
    expect(h.lakeRows("records").at(-1)).toMatchObject({ entity_key: "k000003", operation: "retract", payload: {} });
    expect((await h.served()).map((row) => row.id)).toEqual(["k000000", "k000001", "k000002"]);
  });

  it("keeps current state when a streamed product is finalized as unknown (a declared file was absent)", async () => {
    const h = await kernelHarness();
    await baseline(h, 3);
    h.source.records = [];
    h.source.finalCompleteness = "unknown";
    const outcome = await h.collect();
    expect(outcome.revisions).toBe(0);
    expect(await h.served()).toHaveLength(3);
  });

  it("applies explicit source deletions from a delta without touching other entities", async () => {
    const h = await kernelHarness();
    await baseline(h, 3);
    h.source.updateMode = "delta";
    h.source.records = [{ entityKey: "k000001", operation: "delete", payload: {} }, record("k000009", "new")];
    const outcome = await h.collect();
    expect(outcome.revisions).toBe(2);
    expect((await h.served()).map((row) => row.id)).toEqual(["k000000", "k000002", "k000009"]);
  });
});

describe("collection engine: large products use the SQLite index", () => {
  it("stays in SQLite above the in-memory bound, writes only changed rows, and rebuilds only dirty chunks", async () => {
    const h = await kernelHarness();
    const count = SMALL_PRODUCT_ROWS + 5_000;
    await baseline(h, count);
    expect(h.core.productPlans()[0]?.mode).toBe("large");
    const served = await h.served();
    expect(served).toHaveLength(count);
    const manifestChunks = h.snapshots.chunkPuts().length;
    expect(manifestChunks).toBeGreaterThan(3);
    h.source.records = rows(count, (index) => (index % 5_000 === 7 ? "changed" : index)).filter((_, index) => index !== 12_345);
    const outcome = await h.collect();
    expect(outcome.revisions).toBe(Math.ceil(count / 5_000) + 1);
    const newChunks = h.snapshots.chunkPuts().length - manifestChunks;
    expect(newChunks).toBeGreaterThan(0);
    expect(newChunks).toBeLessThan(manifestChunks / 2);
    const after = await h.served();
    expect(after).toHaveLength(count - 1);
    expect(after.find((row) => row.id === "k012345")).toBeUndefined();
    expect(after.find((row) => row.id === "k000007")?.value).toBe("changed");
    expect(h.lakeRows("records").filter((row) => row.operation === "retract")).toHaveLength(1);
  }, 60_000);

  it("stages heavy rows in batches a Durable Object will accept, measured in UTF-8 bytes", async () => {
    // A Durable Object refuses a serialized call over 32 MiB. Staging counted
    // only in rows sent 2,000 of them whatever they weighed, which was a
    // megabyte for a product of names and codes and 37 MB for one carrying
    // geometry — the land-use boundaries failed on that in production.
    //
    // The text is deliberately not ASCII. A budget that measured JavaScript
    // string length rather than UTF-8 bytes would undercount this by three to
    // one and still pass a test written in Latin letters, so the rows are
    // multibyte and the batches are weighed the way the runtime will weigh them.
    const h = await kernelHarness();
    const heavy = "界".repeat(8 * 1024);
    expect(Buffer.byteLength(heavy, "utf8")).toBe(24 * 1024);
    const count = SMALL_PRODUCT_ROWS + 2_000;
    h.source.records = rows(count, () => heavy);

    const batches: number[] = [];
    const staged = h.port.stageRecords.bind(h.port);
    h.port.stageRecords = async (id, key, sent) => {
      batches.push(sent.reduce((bytes, row) => bytes + Buffer.byteLength(row.json ?? "", "utf8"), 0));
      return staged(id, key, sent);
    };

    expect((await h.collect()).status).toBe("succeeded");
    expect(batches.length).toBeGreaterThan(0);
    // Held to the budget itself rather than to the limit far above it: one row
    // may carry a batch past the mark, but nothing else may.
    expect(Math.max(...batches)).toBeLessThan(STAGE_BYTES + MAX_RECORD_BYTES);
    expect(await h.served()).toHaveLength(count);
  }, 120_000);

  it("promotes a short product whose rows are heavy, and does not demote it back", async () => {
    // What put the parish boundaries and the national road network out of
    // memory in production: three thousand rows, and 122 MB of them, on a path
    // that only ever counted the rows. Each row here carries a quarter of a
    // mebibyte, so a few hundred pass the byte bound while the row bound is
    // nowhere near.
    const outline = "x".repeat(64 * 1024);
    const h = await kernelHarness();
    await baseline(h, 10);
    expect(h.core.productPlans()[0]?.mode).toBe("small");
    const heavy = 500;
    h.source.records = rows(heavy, () => outline);
    const acquisition = h.core.collectNow("manual");
    h.core.markStarted(acquisition.id, "heavy-rows");
    const failure = await h.run(acquisition.id).catch((error: Error) => error);
    if (!(failure instanceof PromotionRequired)) throw new Error(`Expected a promotion, got ${String(failure)}`);
    // It is the weight that promoted it, not the row count, and the message says so.
    expect(failure.message).toMatch(/bytes of rows/);
    await h.port.promote(failure.productKey);
    expect(h.core.productPlans()[0]?.mode).toBe("large");
    expect((await h.run(acquisition.id)).status).toBe("succeeded");
    // Far under the row bound, so a row count alone would send it straight back
    // to the path it just ran out of memory on.
    expect(h.core.productPlans()[0]?.mode).toBe("large");
    expect(h.core.productPlans()[0]?.entry?.rowCount).toBeLessThan(SMALL_PRODUCT_ROWS / 2);
  }, 120_000);

  it("promotes on the same weight of rows whether or not their characters fit Latin-1", async () => {
    // A JavaScript string costs one byte a code unit while every character fits
    // Latin-1 and two as soon as one does not — and it is the whole string that
    // widens. A bound read as though a code unit were always one byte would let
    // a product of Greek or CJK text hold twice what it was allowed, which is
    // the memory this bound exists to keep. Both halves here carry the same
    // number of code units, so both must promote at the same point.
    const promotedAt = async (fill: string): Promise<number> => {
      const h = await kernelHarness();
      await baseline(h, 10);
      h.source.records = rows(2_000, () => fill.repeat(16 * 1024));
      const acquisition = h.core.collectNow("manual");
      h.core.markStarted(acquisition.id, `width-${fill}`);
      const failure = await h.run(acquisition.id).catch((error: Error) => error);
      if (!(failure instanceof PromotionRequired)) throw new Error(`Expected a promotion, got ${String(failure)}`);
      await h.port.promote(failure.productKey);
      await h.run(acquisition.id);
      return h.core.productPlans()[0]?.entry?.rowCount ?? 0;
    };
    // "a" is one byte a code unit in the engine; "界" is two. Same lengths, same bound.
    expect(await promotedAt("界")).toBe(await promotedAt("a"));
  }, 180_000);

  it("promotes a small product that outgrew memory, without inventing creates for existing rows", async () => {
    const h = await kernelHarness();
    await baseline(h, 100);
    expect(h.core.productPlans()[0]?.mode).toBe("small");
    h.source.records = rows(SMALL_PRODUCT_ROWS + 50);
    const acquisition = h.core.collectNow("manual");
    h.core.markStarted(acquisition.id, "promotion-test");
    const failure = await h.run(acquisition.id).catch((error: Error) => error);
    expect(failure).toBeInstanceOf(PromotionRequired);
    if (failure instanceof PromotionRequired) await h.port.promote(failure.productKey);
    expect(h.core.productPlans()[0]?.mode).toBe("large");
    const outcome = await h.run(acquisition.id);
    expect(outcome.revisions).toBe(SMALL_PRODUCT_ROWS + 50 - 100);
    await h.deliver();
    expect(
      h
        .lakeRows("records")
        .slice(100)
        .every((row) => row.operation === "create"),
    ).toBe(true);
  }, 60_000);
});

describe("collection engine: series and history", () => {
  it("keeps a bounded point window and records only corrected or new points", async () => {
    const h = await kernelHarness();
    h.source.kind = "series";
    const point = (hour: number, value: number) => ({ seriesKey: "temp", eventTime: `2026-09-10T${String(hour).padStart(2, "0")}:00:00.000Z`, value, unit: "C", dimensions: {} });
    h.source.points = [point(1, 10), point(2, 11)];
    expect((await h.collect()).revisions).toBe(2);
    h.source.points = [point(1, 10), point(2, 11)];
    expect((await h.collect()).status).toBe("unchanged");
    h.source.points = [point(1, 10), point(2, 12), point(3, 13)];
    expect((await h.collect()).revisions).toBe(2);
    expect(h.lakeRows("points").map((row) => row.value)).toEqual([10, 11, 12, 13]);
    expect(h.entry("readings")?.rowCount).toBe(3);
  });

  it("walks history into the lake only, by itself after the first live success, and completes on explicit exhaustion", async () => {
    const h = await kernelHarness();
    await baseline(h, 2);
    expect(h.core.backfillSummary()?.status).toBe("running");
    h.clock.now += BACKFILL_START_DELAY_MS;
    h.source.records = [{ entityKey: "old-1", payload: { name: "old" }, eventTime: "2026-08-01T00:00:00.000Z" }];
    h.source.fetch = async () => ({ kind: "body", body: new Uint8Array(0), provenance: { sourceUrl: "https://example.test/history" }, completeness: "complete", exhausted: true });
    const acquisition = h.core.takeDue();
    expect(acquisition?.trigger).toBe("history");
    h.core.markStarted(acquisition!.id, "history-test");
    const publications = h.published.length;
    await h.run(acquisition!.id);
    await h.deliver();
    expect(h.published.length).toBe(publications);
    expect(h.lakeRows("records").at(-1)).toMatchObject({ entity_key: "old-1", product_version: 0, event_time: "2026-08-01T00:00:00.000Z" });
    expect(h.core.backfillSummary()).toMatchObject({ status: "complete", slices: 1, records: 1 });
  });
});

describe("collection engine: a product that changes kind", () => {
  it("lets go of a table's rows and change window once it is a series, and deletes them", async () => {
    const h = await kernelHarness();
    await baseline(h, 3);
    const table = h.entry();
    const tableKeys = [...(table?.chunks ?? []).map((chunk) => chunk.key), table?.changesKey ?? ""];
    expect(tableKeys).toHaveLength(2);
    expect(tableKeys.every((key) => key !== "" && h.snapshots.objects.has(key))).toBe(true);
    h.source.kind = "series";
    h.source.seriesProduct = "things";
    h.source.points = [{ seriesKey: "temp", eventTime: "2026-09-10T01:00:00.000Z", value: 10, unit: "C", dimensions: {} }];
    expect((await h.collect()).status).toBe("succeeded");
    expect(h.entry()).toMatchObject({ kind: "series", role: "time-series", chunks: null, changesKey: null, rowCount: 1 });
    expect(h.entry()?.seriesKey).toBeTruthy();
    expect(await h.served()).toEqual([]);
    h.clock.now += 2 * 60 * 60_000;
    await h.core.collectGarbage();
    expect(tableKeys.some((key) => h.snapshots.objects.has(key))).toBe(false);
  });
});

describe("collection engine: history per product and fewer round trips", () => {
  const changeWindows = (h: KernelHarness) => h.snapshots.putKeys.filter((key) => key.includes("/changes/")).length;

  it("keeps no history for a product its policy leaves out, and serves it as before", async () => {
    const h = await kernelHarness({ policy: policy({ withoutHistory: ["things"] }), history: null });
    expect((await h.collect()).historyRows).toBe(0);
    await baseline(h, 3);
    h.source.records = rows(3, (index) => (index === 0 ? "moved" : index));
    const moved = await h.collect();
    expect(moved).toMatchObject({ status: "succeeded", revisions: 1, historyRows: 0 });
    expect((await h.served()).find((row) => row.id === "k000000")?.value).toBe("moved");
    expect(h.lakeRows()).toEqual([]);
    expect(changeWindows(h)).toBe(0);
    expect(h.entry()?.changesKey).toBeNull();
  });

  it("lets go of a product's change window once its policy leaves it out, and deletes it", async () => {
    const h = await kernelHarness({ history: null });
    await baseline(h, 3);
    const window = h.entry()?.changesKey;
    expect(window).toBeTruthy();
    h.core.configure(h.core.feed()!, policy({ withoutHistory: ["things"] }));
    h.source.records = rows(3, (index) => (index === 1 ? "moved" : index));
    await h.collect();
    expect(h.entry()?.changesKey).toBeNull();
    h.clock.now += 2 * 60 * 60_000;
    await h.core.collectGarbage();
    expect(h.snapshots.objects.has(window!)).toBe(false);
  });

  it("walks no history for a product its policy leaves out", async () => {
    const h = await kernelHarness({ policy: policy({ withoutHistory: ["things"] }) });
    await baseline(h, 2);
    h.clock.now += BACKFILL_START_DELAY_MS;
    h.source.records = [{ entityKey: "old-1", payload: { name: "old" }, eventTime: "2026-08-01T00:00:00.000Z" }];
    h.source.fetch = async () => ({ kind: "body", body: new Uint8Array(0), provenance: { sourceUrl: "https://example.test/history" }, completeness: "complete", exhausted: true });
    const slice = h.core.takeDue()!;
    expect(slice.trigger).toBe("history");
    h.core.markStarted(slice.id, "history-left-out");
    await h.run(slice.id);
    await h.deliver();
    expect(h.lakeRows()).toEqual([]);
  });

  it("delivers committed history inside the collection, and leaves it for the delivery step when the lake refuses", async () => {
    const h = await kernelHarness({ history: null });
    h.source.records = rows(5);
    const sent: number[] = [];
    const first = h.core.collectNow("manual");
    h.core.markStarted(first.id, "inline");
    const delivered = await h.run(first.id, async (_table, lakeRows) => {
      sent.push(lakeRows.length);
    });
    expect(delivered).toMatchObject({ status: "succeeded", historyRows: 5, undelivered: false });
    expect(sent).toEqual([5]);
    expect(h.core.committedOutboxRows()).toBe(0);

    h.source.records = rows(5, (index) => `v${index}`);
    const second = h.core.collectNow("manual");
    h.core.markStarted(second.id, "inline-refused");
    const refused = await h.run(second.id, async () => {
      throw new Error("Pipeline submission timed out");
    });
    expect(refused).toMatchObject({ status: "succeeded", historyRows: 5, undelivered: true });
    expect(h.core.committedOutboxRows()).toBe(5);
    expect(await h.deliver()).toBe(1);
    expect(h.core.committedOutboxRows()).toBe(0);
  });

  it("asks the runner to declare only new products and products kept in its index", async () => {
    const h = await kernelHarness({ history: null });
    let declares = 0;
    const declare = h.port.declare;
    h.port.declare = async (id, input) => {
      declares += 1;
      return declare(id, input);
    };
    await baseline(h, 3);
    expect(declares).toBe(1);
    h.source.records = rows(3, (index) => (index === 1 ? "changed" : index));
    expect((await h.collect()).revisions).toBe(1);
    expect(declares).toBe(1);
    h.source.records = rows(SMALL_PRODUCT_ROWS + 10);
    const promoted = h.core.collectNow("manual");
    h.core.markStarted(promoted.id, "promote");
    // The attempt that outgrows memory still declares locally; its retry, now kept in the index, asks the runner.
    await h.run(promoted.id).catch(async (error: Error) => {
      if (error instanceof PromotionRequired) await h.port.promote(error.productKey);
    });
    expect(declares).toBe(1);
    await h.run(promoted.id);
    expect(declares).toBe(2);
  }, 60_000);
});

// The harness's SQLite refuses values over 2 MB, as Durable Objects do; these
// products failed in production with "string or blob too big: SQLITE_TOOBIG".
describe("collection engine: SQLite value limit", () => {
  it("stores large accented rows of a small product without a history blob over 2 MB", async () => {
    const h = await kernelHarness({ keepLake: true, policy: policy({ maxRecordBytes: 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024 }) });
    // About 998,000 bytes per row but 499,000 characters: two such rows passed a 900,000-character budget together.
    h.source.records = Array.from({ length: 3 }, (_, index) => record(`k${index}`, "ã".repeat(499_000)));
    expect((await h.collect()).status).toBe("succeeded");
    expect(h.entry()).toMatchObject({ rowCount: 3 });
    expect(h.lakeRows("records")).toHaveLength(3);
  });

  it("splits a staged batch of a large product whose rows add up to more than 2 MB", async () => {
    const h = await kernelHarness();
    // 2,000 rows of about 1.2 KB: one staged batch is about 2.4 MB.
    h.source.records = rows(SMALL_PRODUCT_ROWS + 500, (index) => `${index} ${"x".repeat(1_200)}`);
    expect((await h.collect()).status).toBe("succeeded");
    expect(h.entry()).toMatchObject({ rowCount: SMALL_PRODUCT_ROWS + 500 });
  }, 120_000);
});

describe("collection engine: the source link", () => {
  it("reports where a live collection read its data, so the product page can link to it", async () => {
    const h = await kernelHarness();
    await baseline(h, 2);
    expect(h.core.status().sourceUrl).toBe("https://example.test/things");
  });

  it("passes only a plain web address: no other scheme and no credentials", () => {
    expect(openableUrl("https://example.test/a b?x=1")).toBe("https://example.test/a%20b?x=1");
    expect(openableUrl("http://example.test/")).toBe("http://example.test/");
    expect(openableUrl("javascript:alert(1)")).toBeUndefined();
    expect(openableUrl("https://user:secret@example.test/")).toBeUndefined();
    expect(openableUrl("unknown:")).toBeUndefined();
    expect(openableUrl("not a url")).toBeUndefined();
  });
});

describe("collection engine: the Workflow step", () => {
  async function begun() {
    const h = await kernelHarness();
    const acquisition = h.core.collectNow("manual");
    h.core.markStarted(acquisition.id, `${acquisition.id}-test`);
    return { h, id: acquisition.id };
  }

  it("returns a source failure to the runner instead of throwing it out of the step", async () => {
    const { h, id } = await begun();
    const failing: CollectingGatekeeper = { collect: async () => ({ kind: "failure", code: "upstream-error", retryable: true, retryAfterSeconds: 30 }) };
    await expect(collectionStep(id, { runner: h.port, gatekeeper: failing, objects: h.objects })).resolves.toEqual({
      failure: { message: "Gatekeeper collection failed: upstream-error", retryable: true, retryAfterSeconds: 30 },
    });
  });

  it("throws only what a quick step retry can cure", async () => {
    const { h, id } = await begun();
    const lost: CollectingGatekeeper = {
      collect: async () => {
        throw new Error("Network connection lost");
      },
    };
    await expect(collectionStep(id, { runner: h.port, gatekeeper: lost, objects: h.objects })).rejects.toThrow("Network connection lost");
  });

  it("returns a missed deadline to the runner, which retries it later", async () => {
    const { h, id } = await begun();
    const slow: CollectingGatekeeper = {
      collect: async () => {
        throw new Error("Collection deadline exceeded");
      },
    };
    await expect(collectionStep(id, { runner: h.port, gatekeeper: slow, objects: h.objects })).resolves.toMatchObject({
      failure: { message: "Collection deadline exceeded", retryable: true },
    });
  });
});
