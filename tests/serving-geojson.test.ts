import type { FieldType, JsonObject } from "@open-data-pt/gatekeeper-shared";
import { describe, expect, it } from "vitest";
import { buildChunks, compareKeys } from "../apps/kernel/src/chunks";
import type { ProductDetail } from "../apps/kernel/src/coordinators";
import { ObjectStore, keys } from "../apps/kernel/src/object-store";
import { InvalidQueryError, Serving, type RowFilters } from "../apps/kernel/src/serving";
import { MemorySnapshots } from "./kernel-harness";
import { jsonAs } from "./support";

/** One product published over real content-addressed chunks, listed on its entry. */
async function serving(schemaFields: Array<{ name: string; type: FieldType }>, records: JsonObject[]) {
  const snapshots = new MemorySnapshots();
  const objects = new ObjectStore(snapshots);
  const rows = records
    .map((record) => ({ key: String(record.id), json: JSON.stringify({ ...record, _hash: "h", _time: { validFrom: record.validFrom ?? null, validTo: record.validTo ?? null } }) }))
    .sort((a, b) => compareKeys(a.key, b.key));
  const chunks = await buildChunks(rows, {
    prefix: keys.prefix("feed_1", "places"),
    known: new Set(),
    put: async (key, body) => {
      await objects.writeText(key, body);
    },
  });
  const product: ProductDetail = {
    id: "prd_1",
    slug: "places",
    feedId: "feed_1",
    productKey: "places",
    title: "Places",
    description: "test",
    role: "reference",
    kind: "record",
    schema: { fields: schemaFields.map((field) => ({ id: field.name, nullable: true, ...field })) },
    updateMode: "authoritative-snapshot",
    completeness: "complete",
    version: 1,
    status: "current",
    currentAcquisitionId: "acq_1",
    watermark: null,
    rowCount: rows.length,
    chunks,
    changesKey: null,
    seriesKey: null,
    seriesChangesKey: null,
    updatedAt: "2026-09-10T00:00:00.000Z",
    createdAt: "2026-09-10T00:00:00.000Z",
    stale: false,
    exposeHistory: true,
    historyMode: "changes",
    licence: null,
    attribution: null,
    staleAfterSeconds: 3600,
    cadenceSeconds: 3600,
  };
  const service = new Serving({ listProducts: async () => [product], getProduct: async (slug) => (slug === "places" ? product : undefined) }, objects);
  return { serving: service, product, chunks };
}

async function geojson(service: Serving, product: ProductDetail, filters?: RowFilters) {
  return jsonAs<{ type: string; features: Array<{ id: string; geometry: JsonObject; properties: JsonObject }>; numberMatched?: number; numberReturned: number }>(
    await new Response(await service.geoJson(product, filters)).text(),
  );
}

async function allRecords(service: Serving, product: ProductDetail, filters?: RowFilters) {
  return jsonAs<{ data: JsonObject[]; numberMatched?: number; numberReturned: number }>(await new Response(await service.allRecords(product, filters)).text());
}

describe("a product is looked up once, in the Registry", () => {
  it("finds a product with its chunk list and nothing for a slug it does not own", async () => {
    const catalog = await serving([{ name: "name", type: "string" }], [{ id: "a", name: "x" }]);
    expect((await catalog.serving.product("places"))?.chunks).toHaveLength(1);
    expect(await catalog.serving.product("elsewhere")).toBeUndefined();
    expect((await catalog.serving.listProducts()).map((product) => product.slug)).toEqual(["places"]);
  });
});

describe("GeoJSON is streamed chunk by chunk from the chunk list", () => {
  it("uses a geometry field as the feature geometry and keeps the centroid as a property", async () => {
    const { serving: service, product } = await serving(
      [
        { name: "geometry", type: "geometry" },
        { name: "lat", type: "latitude" },
        { name: "lon", type: "longitude" },
      ],
      [
        {
          id: "a",
          geometry: {
            type: "LineString",
            coordinates: [
              [-9.1, 38.7],
              [-9.2, 38.8],
            ],
          },
          lat: 38.75,
          lon: -9.15,
        },
      ],
    );
    const body = await geojson(service, product);
    expect(body.features[0]?.geometry).toEqual({
      type: "LineString",
      coordinates: [
        [-9.1, 38.7],
        [-9.2, 38.8],
      ],
    });
    expect(body.features[0]?.properties).toMatchObject({ lat: 38.75, lon: -9.15 });
    expect(body.features[0]?.properties).not.toHaveProperty("_hash");
  });

  it("builds points from coordinates, skips rows without them, and joins many chunks into one valid collection", async () => {
    const records = Array.from({ length: 12_000 }, (_, index) =>
      index % 1000 === 0 ? { id: `p${index}`, name: "no coordinates" } : { id: `p${index}`, lat: 38 + index / 100_000, lon: -9 },
    );
    const {
      serving: service,
      product,
      chunks,
    } = await serving(
      [
        { name: "lat", type: "latitude" },
        { name: "lon", type: "longitude" },
      ],
      records,
    );
    expect(chunks.length).toBeGreaterThan(2);
    const body = await geojson(service, product);
    expect(body.numberMatched).toBe(12_000);
    expect(body.numberReturned).toBe(12_000 - 12);
    expect(body.features).toHaveLength(12_000 - 12);
    expect(body.features[0]?.geometry.type).toBe("Point");
  });

  it("refuses products without geometry or coordinate fields", async () => {
    const { serving: service, product } = await serving([{ name: "name", type: "string" }], [{ id: "a", name: "x" }]);
    await expect(service.geoJson(product)).rejects.toThrow(/no geometry/);
  });
});

describe("record pages follow the chunk list across chunk boundaries", () => {
  it("refuses a cursor into a version the product no longer serves", async () => {
    const { serving: service, product } = await serving([{ name: "n", type: "number" }], [{ id: "a", n: 1 }]);
    await expect(service.records(product, { limit: 5, cursor: "v2:0:0" })).rejects.toThrow(/start again without a cursor/);
  });

  it("returns every record exactly once through cursors, and filters by validity", async () => {
    const records = Array.from({ length: 9_000 }, (_, index) => ({
      id: `r${String(index).padStart(5, "0")}`,
      n: index,
      validFrom: index % 2 === 0 ? "2026-01-01T00:00:00.000Z" : "2027-01-01T00:00:00.000Z",
    }));
    const { serving: service, product } = await serving([{ name: "n", type: "number" }], records);
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.records(product, cursor ? { limit: 500, cursor } : { limit: 500 });
      seen.push(...page.data.map((row) => String(row.id)));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toHaveLength(9_000);
    expect(new Set(seen).size).toBe(9_000);
    const valid = await service.records(product, { limit: 50, validAt: "2026-06-01T00:00:00.000Z" });
    expect(valid.data).toHaveLength(50);
    expect(valid.data.every((row) => Number(row.n) % 2 === 0)).toBe(true);
  });
});

describe("record filters are checked against the schema and applied while reading chunks", () => {
  const fields: Array<{ name: string; type: FieldType }> = [
    { name: "name", type: "string" },
    { name: "kind", type: "category" },
    { name: "n", type: "number" },
    { name: "lat", type: "latitude" },
    { name: "lon", type: "longitude" },
  ];
  const records = Array.from({ length: 30 }, (_, index) => ({
    id: `r${String(index).padStart(2, "0")}`,
    name: `stop ${index}`,
    kind: index % 3 === 0 ? "bus" : "tram",
    n: index,
    lat: 38 + index / 100,
    lon: -9,
  }));

  it("matches where filters on category and string fields, all of them together", async () => {
    const { serving: service, product } = await serving(fields, records);
    const buses = await service.records(product, { limit: 50, filters: { where: [{ field: "kind", value: "bus" }] } });
    expect(buses.data).toHaveLength(10);
    expect(buses.data.every((row) => row.kind === "bus")).toBe(true);
    const one = await service.records(product, {
      limit: 50,
      filters: {
        where: [
          { field: "kind", value: "bus" },
          { field: "name", value: "stop 3" },
        ],
      },
    });
    expect(one.data.map((row) => row.id)).toEqual(["r03"]);
  });

  it("keeps rows inside a bounding box", async () => {
    const { serving: service, product } = await serving(fields, records);
    const page = await service.records(product, { limit: 50, filters: { bbox: { west: -9.1, south: 37.9, east: -8.9, north: 38.105 } } });
    expect(page.data.map((row) => row.n)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it("refuses unknown fields, non-text fields, and a box without coordinates", async () => {
    const { serving: service, product } = await serving(fields, records);
    await expect(service.records(product, { limit: 5, filters: { where: [{ field: "missing", value: "x" }] } })).rejects.toThrow(InvalidQueryError);
    await expect(service.records(product, { limit: 5, filters: { where: [{ field: "n", value: "1" }] } })).rejects.toThrow(/number field/);
    const plain = await serving([{ name: "name", type: "string" }], [{ id: "a", name: "x" }]);
    await expect(plain.serving.records(plain.product, { limit: 5, filters: { bbox: { west: 0, south: 0, east: 1, north: 1 } } })).rejects.toThrow(/latitude and longitude/);
  });

  it("filters the GeoJSON export too, leaving numberMatched out", async () => {
    const { serving: service, product } = await serving(fields, records);
    const body = await geojson(service, product, { where: [{ field: "kind", value: "tram" }] });
    expect(body.numberReturned).toBe(20);
    expect(body.numberMatched).toBeUndefined();
    expect(body.features.every((feature) => feature.properties.kind === "tram")).toBe(true);
  });
});

describe("every current record in one streamed response", () => {
  it("joins every chunk into one document, each record once and without the storage hash", async () => {
    const records = Array.from({ length: 9_000 }, (_, index) => ({ id: `r${String(index).padStart(5, "0")}`, n: index }));
    const { serving: service, product, chunks } = await serving([{ name: "n", type: "number" }], records);
    expect(chunks.length).toBeGreaterThan(2);
    const body = await allRecords(service, product);
    expect(body.numberMatched).toBe(9_000);
    expect(body.numberReturned).toBe(9_000);
    expect(new Set(body.data.map((row) => row.id)).size).toBe(9_000);
    expect(body.data[0]).not.toHaveProperty("_hash");
  });

  it("applies where filters while streaming and leaves numberMatched out", async () => {
    const records = Array.from({ length: 30 }, (_, index) => ({ id: `r${String(index).padStart(2, "0")}`, kind: index % 3 === 0 ? "bus" : "tram" }));
    const { serving: service, product } = await serving([{ name: "kind", type: "category" }], records);
    const body = await allRecords(service, product, { where: [{ field: "kind", value: "bus" }] });
    expect(body.numberReturned).toBe(10);
    expect(body.numberMatched).toBeUndefined();
    expect(body.data.every((row) => row.kind === "bus")).toBe(true);
  });
});
