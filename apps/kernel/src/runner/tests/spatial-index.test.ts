import { asArrayOrEmpty, asObject, parseJson, type CanonicalField, type CanonicalRecord } from "@open-data-pt/contract";
import { describe, expect, it } from "vitest";
import { chunkListProblem, isChunkBoundary, type ChunkObject } from "#/serving/chunks";
import { geometryBox, type Box } from "#/serving/spatial";
import { kernelHarness, type KernelHarness } from "#/tests/kernel-harness";

const HOUR = 3_600_000;

const PLACED: CanonicalField[] = [
  { id: "name", name: "name", type: "string", nullable: false },
  { id: "geometry", name: "geometry", type: "geometry", nullable: true },
];

/** A small square parcel; Lisbon's are around 38.7°N 9.1°W, Porto's around 41.1°N 8.6°W. */
function parcel(key: string, longitude: number, latitude: number, padding = ""): CanonicalRecord {
  const ring = [
    [longitude, latitude],
    [longitude + 0.001, latitude],
    [longitude + 0.001, latitude + 0.001],
    [longitude, latitude + 0.001],
    [longitude, latitude],
  ];
  return { entityKey: key, payload: { name: `Parcel ${key}${padding}`, geometry: { type: "Polygon", coordinates: [ring] } } };
}

/** Parcels whose keys alternate between the two cities, so key order would mix them in every chunk. */
function twoCities(count: number, padding = ""): CanonicalRecord[] {
  return Array.from({ length: count }, (_, index) => {
    const key = `p${String(index).padStart(5, "0")}`;
    const step = Math.floor(index / 2) * 0.002;
    return index % 2 === 0 ? parcel(key, -9.2 + step, 38.7, padding) : parcel(key, -8.7 + step, 41.1, padding);
  });
}

async function placedHarness(): Promise<KernelHarness> {
  const h = await kernelHarness();
  h.source.fields = PLACED;
  return h;
}

function expectBox(box: Box | null | undefined, west: number, south: number, east: number, north: number): void {
  expect(box?.west).toBeCloseTo(west, 5);
  expect(box?.south).toBeCloseTo(south, 5);
  expect(box?.east).toBeCloseTo(east, 5);
  expect(box?.north).toBeCloseTo(north, 5);
}

function within(inner: Box, outer: Box): boolean {
  return inner.west >= outer.west && inner.east <= outer.east && inner.south >= outer.south && inner.north <= outer.north;
}

/** Every served row lies inside the box its chunk lists; returns the rows in served order. */
async function checkChunkBoxes(h: KernelHarness): Promise<string[]> {
  const ids: string[] = [];
  for (const chunk of h.entry()?.chunks ?? []) {
    expect(chunk.box, chunk.key).toBeTruthy();
    for (const row of (await h.objects.read<ChunkObject>(chunk.key))?.rows ?? []) {
      const box = geometryBox(asObject(row.geometry) ?? {});
      expect(box && chunk.box && within(box, chunk.box), String(row.id)).toBe(true);
      ids.push(String(row.id));
    }
  }
  return ids;
}

/** How many chunks hold parcels of both cities: in place order only the one where the curve crosses between them. */
function mixedChunks(h: KernelHarness): number {
  return (h.entry()?.chunks ?? []).filter((chunk) => chunk.box && chunk.box.south < 39 && chunk.box.north > 41).length;
}

/** Put the runner back in the state a product published before spatial order is in: no extent, no chunk boxes, no order keys. */
function forgetSpatialIndex(h: KernelHarness): void {
  for (const row of h.database.prepare("SELECT product_key, entry_json FROM products").all()) {
    const entry = asObject(parseJson(String(row.entry_json))) ?? {};
    delete entry.extent;
    for (const chunk of asArrayOrEmpty(entry.chunks)) delete asObject(chunk)?.box;
    h.database.prepare("UPDATE products SET entry_json = ? WHERE product_key = ?").run(JSON.stringify(entry), String(row.product_key));
  }
  h.database.exec("UPDATE entities SET order_key = NULL");
}

describe("a small located product", () => {
  it("is chunked in place order, with a box on each chunk and the product's extent on its entry", async () => {
    const h = await placedHarness();
    h.source.records = twoCities(200);
    await h.collect();
    expectBox(h.entry()?.extent, -9.2, 38.7, -8.501, 41.101);
    const served = await checkChunkBoxes(h);
    expect(served).toHaveLength(200);
    // The two cities are not interleaved as their keys are: each city's parcels are contiguous.
    const cities = served.map((id) => Number(id.slice(1)) % 2);
    expect(cities.filter((city, index) => index > 0 && city !== cities[index - 1])).toHaveLength(1);
  });

  it("is rebuilt in place order by its runner when it was published before, without waiting for its source", async () => {
    const h = await placedHarness();
    h.source.records = twoCities(200);
    await h.collect();
    forgetSpatialIndex(h);
    const before = h.core.productPlans()[0]!.entry;
    expect(before.extent).toBeUndefined();
    expect(h.core.unplacedProduct()?.slug).toBe("things");
    // Nothing else is due, so the runner wakes for it at once.
    expect(h.core.nextAlarm()).toBe(h.clock.now + 1000);
    expect(await h.core.indexSpatially()).toBe(true);
    const after = h.entry();
    expectBox(after?.extent, -9.2, 38.7, -8.501, 41.101);
    // Same rows under a new version, so no records cursor walks the old chunk layout.
    expect(after?.version).toBe(before.version + 1);
    expect(await checkChunkBoxes(h)).toHaveLength(200);
    expect(h.core.unplacedProduct()).toBeUndefined();
    expect(await h.core.indexSpatially()).toBe(false);
    // The source has not changed: the next collection finds nothing to do.
    expect((await h.collect()).status).toBe("unchanged");
  });

  it("is rebuilt by a collection that reaches it, even one with nothing new", async () => {
    const h = await placedHarness();
    h.source.records = twoCities(50);
    await h.collect();
    forgetSpatialIndex(h);
    const outcome = await h.collect();
    expect(outcome.revisions).toBe(0);
    expect(h.entry()?.extent).toBeTruthy();
    expect(h.core.unplacedProduct()).toBeUndefined();
  });

  it("waits hours before trying again when a rebuild fails", async () => {
    const h = await placedHarness();
    h.source.records = twoCities(20);
    await h.collect();
    forgetSpatialIndex(h);
    for (const chunk of h.core.productPlans()[0]!.entry.chunks ?? []) await h.snapshots.delete([chunk.key]);
    expect(await h.core.indexSpatially()).toBe(false);
    expect(h.core.unplacedProduct()).toBeUndefined();
    // It let go of the publication slot it took, or no collection could begin.
    expect(h.core.getState("publication")).toBeUndefined();
    h.clock.now += 7 * HOUR;
    expect(h.core.unplacedProduct()?.slug).toBe("things");
  });

  it("leaves a product with no place in entity order, without boxes", async () => {
    const h = await kernelHarness();
    h.source.records = [
      { entityKey: "b", payload: { name: "B", value: 1 } },
      { entityKey: "a", payload: { name: "A", value: 2 } },
    ];
    await h.collect();
    expect(h.entry()?.extent).toBeUndefined();
    expect(h.entry()?.chunks?.[0]).toMatchObject({ first: "a", last: "b" });
    expect(h.entry()?.chunks?.[0]?.box).toBeUndefined();
    expect(h.core.unplacedProduct()).toBeUndefined();
  });
});

describe("a large located product", () => {
  // Each parcel carries 64 KiB of text, so six hundred of them are too heavy to compare in memory and stay on the SQLite index.
  const padding = "x".repeat(64 * 1024);
  const COUNT = 600;

  it("keeps its index in place order, so a moved row leaves one chunk and joins another", async () => {
    const h = await placedHarness();
    h.source.records = twoCities(COUNT, padding);
    await h.collect();
    expect(h.core.productPlans()[0]?.mode).toBe("large");
    expect(h.entry()?.chunks?.length).toBeGreaterThan(12);
    expect(await checkChunkBoxes(h)).toHaveLength(COUNT);
    expect(mixedChunks(h)).toBeLessThanOrEqual(1);

    h.source.records = twoCities(COUNT, padding).map((record) => (record.entityKey === "p00010" ? parcel("p00010", -8.69, 41.1, padding) : record));
    expect((await h.collect()).revisions).toBe(1);
    expect(h.core.productPlans()[0]?.mode).toBe("large");
    const served = await checkChunkBoxes(h);
    expect(served.filter((id) => id === "p00010")).toHaveLength(1);
    expect(served).toHaveLength(COUNT);
    expect(mixedChunks(h)).toBeLessThanOrEqual(1);
  }, 120_000);

  it("is rebuilt from its index in place order when it was published before", async () => {
    const h = await placedHarness();
    h.source.records = twoCities(COUNT, padding);
    await h.collect();
    forgetSpatialIndex(h);
    const version = h.core.productPlans()[0]!.entry.version;
    expect(h.core.unplacedProduct()?.mode).toBe("large");
    expect(await h.core.indexSpatially()).toBe(true);
    expect(h.entry()?.version).toBe(version + 1);
    expectBox(h.entry()?.extent, -9.2, 38.7, -8.7 + (COUNT / 2 - 1) * 0.002 + 0.001, 41.101);
    expect(await checkChunkBoxes(h)).toHaveLength(COUNT);
    expect(mixedChunks(h)).toBeLessThanOrEqual(1);
    expect(h.core.unplacedProduct()).toBeUndefined();
  }, 120_000);

  it("keeps serving the version it had when a rebuild fails, and keeps its chunks", async () => {
    const h = await placedHarness();
    h.source.records = twoCities(COUNT, padding);
    await h.collect();
    forgetSpatialIndex(h);
    const before = h.core.productPlans()[0]!.entry;
    const publications = h.published.length;
    // The index holds rows its chunks do not yet serve, so the rebuild has new chunks to write; and R2 refuses them.
    h.database.exec("UPDATE entities SET row_json = replace(row_json, 'Parcel', 'Lot')");
    h.snapshots.failPuts = true;
    expect(await h.core.indexSpatially()).toBe(false);
    h.snapshots.failPuts = false;
    // Nothing was published, the entry is the one before, and none of its chunks is waiting to be deleted.
    expect(h.published.length).toBe(publications);
    expect(h.core.productPlans()[0]).toMatchObject({ entry: before, regenerate: false });
    const garbage = new Set(
      h.database
        .prepare("SELECT object_key FROM garbage")
        .all()
        .map((row) => String(row.object_key)),
    );
    expect((before.chunks ?? []).filter((chunk) => garbage.has(chunk.key))).toEqual([]);
    for (const chunk of before.chunks ?? []) expect(await h.objects.readText(chunk.key), chunk.key).toBeDefined();
    // The publication slot is free again, so collections go on, and the rebuild is tried again later.
    expect(h.core.getState("publication")).toBeUndefined();
    expect(h.core.unplacedProduct()).toBeUndefined();
    h.clock.now += 7 * HOUR;
    expect(h.core.unplacedProduct()?.mode).toBe("large");
  }, 120_000);

  it("never publishes a rebuild whose chunk list is too long to store, and keeps serving the version before", async () => {
    // Keys whose hash closes a chunk, so every row is a chunk of its own; five thousand of them list in just under the
    // stored-value limit in key order, and over it once each chunk carries a box and a longer order key.
    const keys: string[] = [];
    for (let index = 0; keys.length < 5_000; index += 1) {
      const key = `parcel-${String(index).padStart(13, "0")}`;
      if (isChunkBoundary(key)) keys.push(key);
    }
    const h = await kernelHarness();
    // Published before boxes: the same rows under a schema that did not yet say where they are.
    h.source.records = keys.map((key, index) => parcel(key, -9.2 + (index % 100) * 0.002, 38.7 + Math.floor(index / 100) * 0.002, "x".repeat(3 * 1024)));
    await h.collect();
    const legacy = h.core.productPlans()[0]!;
    expect(legacy.mode).toBe("large");
    expect(chunkListProblem(legacy.entry.chunks ?? [], "things")).toBeUndefined();
    h.database.prepare("UPDATE products SET entry_json = ?").run(JSON.stringify({ ...legacy.entry, schema: { fields: PLACED } }));
    const before = h.core.productPlans()[0]!.entry;
    const publications = h.published.length;

    expect(await h.core.indexSpatially()).toBe(false);
    // Nothing failed was published, the entry is the one before, and none of its chunks is waiting to be deleted.
    expect(h.published.length).toBe(publications);
    expect(h.core.productPlans()[0]).toMatchObject({ entry: before, regenerate: false });
    const garbage = new Set(
      h.database
        .prepare("SELECT object_key FROM garbage")
        .all()
        .map((row) => String(row.object_key)),
    );
    expect((before.chunks ?? []).filter((chunk) => garbage.has(chunk.key))).toEqual([]);
    expect(h.core.getState("publication")).toBeUndefined();
  }, 120_000);
});
