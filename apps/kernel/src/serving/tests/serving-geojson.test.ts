import type { FieldType, JsonObject } from "@open-data-pt/contract";
import { describe, expect, it } from "vitest";
import { buildChunks, compareKeys, writeChunk, type ChunkSink, type ServingRow } from "#/serving/chunks";
import type { ProductDetail } from "#/registry/registry";
import { ObjectStore, keys, type SeriesWindow } from "#/serving/object-store";
import { InvalidQueryError, RECORD_SCAN_BUDGET, Serving, type RecordQuery, type RowFilters } from "#/serving/serving";
import { EMPTY_VOCABULARIES, Vocabulary } from "#/registry/vocabulary";
import { MemorySnapshots } from "#/tests/kernel-harness";
import { jsonAs } from "#/tests/support";

/**
 * One product published over real content-addressed chunks, listed on its entry. With
 * `rowsPerChunk` the chunks are cut every that many rows instead of where keys say, so a test can
 * lay out hundreds of chunks from a few thousand rows.
 */
async function serving(schemaFields: Array<{ name: string; type: FieldType }>, records: JsonObject[], rowsPerChunk?: number) {
  const snapshots = new MemorySnapshots();
  const objects = new ObjectStore(snapshots);
  const rows = records
    .map((record) => ({ key: String(record.id), json: JSON.stringify({ ...record, _hash: "h", _time: { validFrom: record.validFrom ?? null, validTo: record.validTo ?? null } }) }))
    .sort((a, b) => compareKeys(a.key, b.key));
  const sink: ChunkSink = {
    prefix: keys.prefix("feed_1", "places"),
    known: new Set(),
    put: async (key, body) => {
      await objects.writeText(key, body);
    },
  };
  const chunks = rowsPerChunk ? await fixedChunks(rows, rowsPerChunk, sink) : await buildChunks(rows, sink);
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
  return { serving: service, product, chunks, objects };
}

async function fixedChunks(rows: ServingRow[], rowsPerChunk: number, sink: ChunkSink) {
  const chunks = [];
  for (let start = 0; start < rows.length; start += rowsPerChunk) chunks.push(await writeChunk(sink, rows.slice(start, start + rowsPerChunk)));
  return chunks;
}

/** Every page of a records query, following its cursors to the end. */
async function pages(service: Serving, product: ProductDetail, query: RecordQuery) {
  const all = [];
  let cursor: string | undefined;
  do {
    const page = await service.records(product, cursor ? { ...query, cursor } : query);
    all.push(page);
    cursor = page.nextCursor;
  } while (cursor);
  return all;
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

  /** Ten rows to a chunk; `kind` is "bus" where `bus` says so and "tram" everywhere else. */
  const fleet = (count: number, bus: (index: number) => boolean) =>
    Array.from({ length: count }, (_, index) => ({ id: `r${String(index).padStart(5, "0")}`, kind: bus(index) ? "bus" : "tram" }));
  const kind: Array<{ name: string; type: FieldType }> = [{ name: "kind", type: "category" }];
  const buses: RowFilters = { where: [{ field: "kind", value: "bus" }] };

  it("reads on past chunks with no match, and answers a match in a late chunk in one page", async () => {
    // Forty chunks, the only matches in the 31st: an empty page with a cursor is read as "none" and the reader stops.
    const records = fleet(400, (index) => index >= 305 && index < 308);
    const { serving: service, product, chunks } = await serving(kind, records, 10);
    expect(chunks).toHaveLength(40);
    const page = await service.records(product, { limit: 5, filters: buses });
    expect(page.data.map((row) => row.id)).toEqual(["r00305", "r00306", "r00307"]);
    expect(page.nextCursor).toBeUndefined();
  });

  it("fills every page across chunk boundaries, and its cursors resume mid-chunk without skipping or repeating a row", async () => {
    // Matches scattered through the first and last ten chunks, a run in the middle, and ten chunks with none either side of it.
    const records = fleet(400, (index) => ((index < 100 || index >= 300) && index % 7 === 3) || (index >= 200 && index < 216));
    const { serving: service, product } = await serving(kind, records, 10);
    const expected = records.filter((record) => record.kind === "bus").map((record) => record.id);
    const answered = await pages(service, product, { limit: 4, filters: buses });
    expect(answered.flatMap((page) => page.data.map((row) => row.id))).toEqual(expected);
    // Only the last page may be short: no page stops while matches remain.
    expect(answered.slice(0, -1).every((page) => page.data.length === 4)).toBe(true);
  });

  it("ends a product with no match in one empty page with no cursor", async () => {
    const { serving: service, product } = await serving(
      kind,
      fleet(400, () => false),
      10,
    );
    expect(await service.records(product, { limit: 5, filters: buses })).toEqual({ data: [] });
  });

  it("stops at its chunk budget with a cursor, empty when nothing matched, and the cursor carries on to the match", async () => {
    const count = (RECORD_SCAN_BUDGET.chunks + 4) * 2;
    const records = fleet(count, (index) => index === count - 1);
    const { serving: service, product, chunks } = await serving(kind, records, 2);
    expect(chunks.length).toBeGreaterThan(RECORD_SCAN_BUDGET.chunks);
    const answered = await pages(service, product, { limit: 5, filters: buses });
    expect(answered.map((page) => page.data.map((row) => row.id))).toEqual([[], [records.at(-1)!.id]]);
    expect(answered[0]!.nextCursor).toBeDefined();
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

  it("keeps streaming past chunks where nothing matches, to a whole document", async () => {
    // Only the last ten rows match, so every chunk before the last yields nothing.
    const records = Array.from({ length: 9_000 }, (_, index) => ({
      id: `r${String(index).padStart(5, "0")}`,
      kind: index >= 8_990 ? "bus" : "tram",
      lat: index >= 8_990 ? 39 : 38,
      lon: -9,
    }));
    const {
      serving: service,
      product,
      chunks,
    } = await serving(
      [
        { name: "kind", type: "category" },
        { name: "lat", type: "latitude" },
        { name: "lon", type: "longitude" },
      ],
      records,
    );
    expect(chunks.length).toBeGreaterThan(2);
    const body = await allRecords(service, product, { where: [{ field: "kind", value: "bus" }] });
    expect(body.numberReturned).toBe(10);
    expect(body.data.map((row) => row.id)).toEqual(records.slice(8_990).map((record) => record.id));
    const inBox = await geojson(service, product, { bbox: { west: -9.1, south: 38.9, east: -8.9, north: 39.1 } });
    expect(inBox.numberReturned).toBe(10);
    const none = await allRecords(service, product, { where: [{ field: "kind", value: "boat" }] });
    expect(none).toEqual({ data: [], numberReturned: 0 });
  });
});

describe("a time-series product counts points, and serves none of them as records", () => {
  /** What the Registry holds for a series product: its points counted in rowCount, and no chunks to serve. */
  async function series(fields: Array<{ name: string; type: FieldType }>) {
    const built = await serving(fields, [{ id: "a", lat: 38.7, lon: -9.1, n: 1 }]);
    const product: ProductDetail = { ...built.product, role: "time-series", kind: "series", rowCount: 351, chunks: null, seriesKey: "series/things/1" };
    return { serving: built.serving, product };
  }

  it("states the records it streams, not the points it holds", async () => {
    const { serving: service, product } = await series([{ name: "n", type: "number" }]);
    const body = await allRecords(service, product);
    expect(body.numberMatched).toBe(0);
    expect(body.numberReturned).toBe(0);
    expect(body.data).toEqual([]);
  });

  it("counts GeoJSON features the same way, even with coordinate fields in its schema", async () => {
    const { serving: service, product } = await series([
      { name: "lat", type: "latitude" },
      { name: "lon", type: "longitude" },
    ]);
    const body = await geojson(service, product);
    expect(body.numberMatched).toBe(0);
    expect(body.numberReturned).toBe(0);
    expect(body.features).toEqual([]);
  });
});

describe("time windows compare instants, however a time is written", () => {
  const point = (eventTime: string) => ({ seriesKey: "solar", eventTime, value: 1, unit: "MW", dimensions: {}, observedAt: eventTime });

  it("keeps a point on either edge of the window, with or without milliseconds on either side", async () => {
    const built = await serving([{ name: "n", type: "number" }], [{ id: "a", n: 1 }]);
    const product: ProductDetail = { ...built.product, role: "time-series", kind: "series", seriesKey: "series/solar" };
    // One source writes milliseconds and another does not.
    await built.objects.write<SeriesWindow>("series/solar", {
      slug: "places",
      updatedAt: "2026-09-18T12:00:00.000Z",
      points: [point("2026-09-18T09:45:00.000Z"), point("2026-09-18T10:00:00.000Z"), point("2026-08-31T00:00:00Z"), point("2026-09-18T10:15:00.000Z")],
    });
    const times = async (from: string, to: string) => (await built.serving.series(product, { limit: 100, from, to })).map((each) => each.eventTime);
    expect(await times("2026-09-18T10:00:00Z", "2026-09-18T10:00:00Z")).toEqual(["2026-09-18T10:00:00.000Z"]);
    expect(await times("2026-09-18T10:00:00.000Z", "2026-09-18T10:00:00.000Z")).toEqual(["2026-09-18T10:00:00.000Z"]);
    expect(await times("2026-08-31T00:00:00.000Z", "2026-08-31T00:00:00.000Z")).toEqual(["2026-08-31T00:00:00Z"]);
    expect(await times("2026-08-31T00:00:00Z", "2026-08-31T00:00:00Z")).toEqual(["2026-08-31T00:00:00Z"]);
  });

  it("reads a record valid at an instant written without milliseconds", async () => {
    const { serving: service, product } = await serving([{ name: "n", type: "number" }], [{ id: "a", n: 1, validFrom: "2026-01-01T00:00:00Z" }]);
    expect((await service.records(product, { limit: 5, validAt: "2026-01-01T00:00:00.000Z" })).data).toHaveLength(1);
  });
});

describe("the DCAT catalog lists each product's downloads", () => {
  it("offers a record product as JSON and as one Parquet file, and a series as JSON only", async () => {
    const built = await serving([{ name: "n", type: "number" }], [{ id: "a", n: 1 }]);
    const series: ProductDetail = { ...built.product, slug: "readings", role: "time-series", kind: "series", chunks: null, seriesKey: "series/readings" };
    const service = new Serving({ listProducts: async () => [built.product, series], getProduct: async () => undefined }, built.objects);
    const catalog = await service.dcatCatalog("https://open-data.pt", [], new Vocabulary(EMPTY_VOCABULARIES));
    const downloads = Object.fromEntries(catalog["dcat:dataset"].map((dataset) => [dataset["@id"].slice(dataset["@id"].lastIndexOf("/") + 1), dataset["dcat:distribution"]]));
    expect(downloads.places).toEqual([
      { "@type": "dcat:Distribution", "dct:format": "application/json", "dcat:accessURL": "https://open-data.pt/api/products/places/records" },
      {
        "@type": "dcat:Distribution",
        "dct:format": "application/vnd.apache.parquet",
        "dcat:mediaType": "https://www.iana.org/assignments/media-types/application/vnd.apache.parquet",
        "dcat:downloadURL": "https://open-data.pt/api/products/places.parquet",
      },
    ]);
    expect(downloads.readings).toEqual([{ "@type": "dcat:Distribution", "dct:format": "application/json", "dcat:accessURL": "https://open-data.pt/api/products/readings/series" }]);
  });
});
