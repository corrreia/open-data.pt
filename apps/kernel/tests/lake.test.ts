import { describe, expect, it } from "vitest";
import type { JsonObject } from "@open-data-pt/contract";
import { LAKE_ROW_BYTES, PipelinesLake, validateLakeRow, type StreamBinding } from "../src/lake";
import { OutboxBuffer } from "../src/outbox";

class MemoryStream implements StreamBinding {
  batches: JsonObject[][] = [];
  async send(rows: JsonObject[]): Promise<void> {
    this.batches.push(rows);
  }
}

function point(index: number, padding = ""): JsonObject {
  return {
    batch_id: "batch",
    revision_id: `revision-${index}`,
    feed_id: "feed",
    product_slug: "series",
    normalizer_id: "fixture",
    normalizer_version: "1",
    schema: {},
    series_key: `series-${index}${padding}`,
    event_time: "2026-09-09T00:00:00.000Z",
    value: index,
    unit: "MW",
    dimensions: {},
    observed_at: "2026-09-09T01:00:00.000Z",
    acquisition_id: "batch",
  };
}

describe("Pipelines delivery", () => {
  it("sends each table to its own stream in requests of at most 1000 rows", async () => {
    const records = new MemoryStream();
    const points = new MemoryStream();
    const lake = new PipelinesLake({ LAKE_RECORDS: records, LAKE_POINTS: points });
    await lake.send(
      "points",
      Array.from({ length: 2_500 }, (_, index) => point(index)),
    );
    expect(points.batches.map((batch) => batch.length)).toEqual([1000, 1000, 500]);
    expect(records.batches).toHaveLength(0);
  });

  it("splits by bytes below the 5 MB request limit", async () => {
    const points = new MemoryStream();
    const lake = new PipelinesLake({ LAKE_RECORDS: new MemoryStream(), LAKE_POINTS: points });
    await lake.send(
      "points",
      Array.from({ length: 30 }, (_, index) => point(index, "x".repeat(300_000))),
    );
    expect(points.batches.length).toBeGreaterThan(1);
    for (const batch of points.batches) expect(new TextEncoder().encode(JSON.stringify(batch)).byteLength).toBeLessThan(5_000_000);
  });

  it("fits a record row over the 1 MB message limit by leaving out its largest values, and leaves out a point that cannot fit", async () => {
    const records = new MemoryStream();
    const points = new MemoryStream();
    const lake = new PipelinesLake({ LAKE_RECORDS: records, LAKE_POINTS: points });
    const outline = { type: "Polygon", coordinates: [Array.from({ length: 60_000 }, (_, index) => [-9.1 + index / 1e6, 38.7])] };
    const record: JsonObject = {
      ...point(1),
      entity_key: "plan-1",
      operation: "upsert",
      product_version: 2,
      ingested_at: "2026-09-09T01:00:00.000Z",
      event_time: null,
      valid_from: null,
      valid_to: null,
      source_published_at: null,
      payload: { name: "Plano Diretor", municipality: "Lisboa", geometry: outline },
    };
    const bytes = new TextEncoder().encode(JSON.stringify(record.payload)).byteLength;
    expect(bytes).toBeGreaterThan(LAKE_ROW_BYTES);
    await lake.send("records", [record, { ...record, entity_key: "plan-2", payload: { name: "Small" } }]);
    const sent = records.batches.flat();
    expect(sent.map((row) => row.entity_key)).toEqual(["plan-1", "plan-2"]);
    expect(sent[0]?.payload).toEqual({ name: "Plano Diretor", municipality: "Lisboa", _omitted: { fields: ["geometry"], bytes } });
    expect(sent[1]?.payload).toEqual({ name: "Small" });
    // A payload with an `_omitted` of its own cannot be trimmed without losing it, so its row is left out whole.
    await lake.send("records", [{ ...record, entity_key: "plan-3", payload: { _omitted: "the source's own", geometry: outline } }]);
    expect(records.batches.flat().map((row) => row.entity_key)).toEqual(["plan-1", "plan-2"]);
    await lake.send("points", [point(0, "x".repeat(1_000_000)), point(1)]);
    expect(points.batches.flat().map((row) => row.revision_id)).toEqual(["revision-1"]);
  });

  it("validates rows against the table before they are accepted", () => {
    expect(() => validateLakeRow(point(1), "points")).not.toThrow();
    expect(() => validateLakeRow({ ...point(1), value: "high" }, "points")).toThrow(/Series history row/);
    expect(() => validateLakeRow({ ...point(1), entity_key: "a", operation: "upsert", product_version: 1, ingested_at: "2026-09-09T01:00:00.000Z" }, "records")).toThrow(/payload/);
  });
});

describe("history outbox blobs", () => {
  it("groups rows into blobs below the size bound, per table, and flushes both on close", async () => {
    const blobs: Array<{ table: string; rows: number; chars: number }> = [];
    const outbox = new OutboxBuffer(async (table, json, rows) => {
      blobs.push({ table, rows, chars: json.length });
    }, 10_000);
    for (let index = 0; index < 100; index += 1) await outbox.add("points", point(index));
    await outbox.add("records", { ...point(1), entity_key: "a", operation: "upsert", product_version: 1, ingested_at: "2026-09-09T01:00:00.000Z", payload: {} });
    await outbox.close();
    expect(blobs.filter((blob) => blob.table === "points").reduce((sum, blob) => sum + blob.rows, 0)).toBe(100);
    expect(blobs.filter((blob) => blob.table === "points").length).toBeGreaterThan(1);
    for (const blob of blobs) expect(blob.chars).toBeLessThanOrEqual(10_000);
    expect(blobs.filter((blob) => blob.table === "records")).toHaveLength(1);
    expect(outbox.rows).toBe(101);
  });

  it("measures UTF-8 bytes and closes a blob before a row would overflow it", async () => {
    const blobs: number[] = [];
    const outbox = new OutboxBuffer(async (_table, json) => {
      blobs.push(new TextEncoder().encode(json).byteLength);
    }, 10_000);
    // Each row is about 3,000 characters but about 6,000 bytes: two never share a 10,000-byte blob.
    for (let index = 0; index < 4; index += 1) {
      await outbox.add("records", {
        ...point(index),
        entity_key: `k${index}`,
        operation: "upsert",
        product_version: 1,
        ingested_at: "2026-09-09T01:00:00.000Z",
        payload: { note: "ã".repeat(3_000) },
      });
    }
    await outbox.close();
    expect(blobs).toHaveLength(4);
    for (const bytes of blobs) expect(bytes).toBeLessThanOrEqual(10_000);
  });

  it("refuses an invalid row before buffering it", async () => {
    const outbox = new OutboxBuffer(async () => undefined);
    await expect(outbox.add("points", { ...point(1), event_time: "yesterday" })).rejects.toThrow();
    expect(outbox.rows).toBe(0);
  });
});
