import type { Product } from "@open-data-pt/api";
import type { FieldType, JsonObject } from "@open-data-pt/contract";
import { describe, expect, it } from "vitest";
import { setExtent } from "#/registry/feed-model";
import type { ProductDetail } from "#/registry/registry";
import { buildChunks, compareRows, extentOf, placedRow, writeChunk, type ManifestChunk } from "#/serving/chunks";
import { ObjectStore, keys } from "#/serving/object-store";
import { NotIndexedError, POINT_LOOKUP, productExtent, productsAt } from "#/serving/point-lookup";
import { InvalidQueryError, Serving, type RecordQuery } from "#/serving/serving";
import { boxesIntersect, geometryBox, hitTest, locatorFor, queryBox, rowBox, spatialOrderKey, unionBox, type Box } from "#/serving/spatial";
import { MemorySnapshots } from "#/tests/kernel-harness";
import { jsonAs } from "#/tests/support";

/* ---------- Fixtures: places in Lisbon, Porto and Faro ---------- */

const square = (west: number, south: number, east: number, north: number) => [
  [west, south],
  [east, south],
  [east, north],
  [west, north],
  [west, south],
];

/** A block in Lisbon with a courtyard cut out of it. */
const BLOCK_WITH_COURTYARD = { type: "Polygon", coordinates: [square(-9.2, 38.7, -9.1, 38.8), square(-9.16, 38.74, -9.14, 38.76)] };
/** Two parcels, the second with a hole: a point in the hole is in neither. */
const TWO_PARCELS = { type: "MultiPolygon", coordinates: [[square(-8.7, 41.1, -8.6, 41.2)], [square(-8.5, 41.1, -8.4, 41.2), square(-8.46, 41.14, -8.44, 41.16)]] };
/** A road running north for about a kilometre at 9°W. */
const ROAD = {
  type: "LineString",
  coordinates: [
    [-9.0, 38.0],
    [-9.0, 38.01],
  ],
};
/** 0.0003° of longitude at 38°N is about 26.3 m. */
const METRES_PER_DEGREE = (6_371_008.8 * Math.PI) / 180;
const metresEast = (degrees: number, latitude: number) => degrees * METRES_PER_DEGREE * Math.cos((latitude * Math.PI) / 180);

describe("boxes", () => {
  it("covers every position of a polygon, a multipolygon with holes, a line, a point and a collection", () => {
    expect(geometryBox(BLOCK_WITH_COURTYARD)).toEqual({ west: -9.2, south: 38.7, east: -9.1, north: 38.8 });
    // A hole never widens a box: it lies inside its outer ring.
    expect(geometryBox(TWO_PARCELS)).toEqual({ west: -8.7, south: 41.1, east: -8.4, north: 41.2 });
    expect(geometryBox(ROAD)).toEqual({ west: -9.0, south: 38.0, east: -9.0, north: 38.01 });
    expect(geometryBox({ type: "Point", coordinates: [-7.93, 37.02] })).toEqual({ west: -7.93, south: 37.02, east: -7.93, north: 37.02 });
    expect(geometryBox({ type: "GeometryCollection", geometries: [ROAD, { type: "Point", coordinates: [-8.9, 38.2] }] })).toEqual({
      west: -9.0,
      south: 38.0,
      east: -8.9,
      north: 38.2,
    });
    expect(geometryBox({ type: "Point", coordinates: [] })).toBeUndefined();
  });

  it("places a row by its geometry, or by its latitude and longitude when it has none", () => {
    const located = locatorFor({
      fields: [
        { id: "geometry", name: "geometry", type: "geometry", nullable: true },
        { id: "lat", name: "lat", type: "latitude", nullable: true },
        { id: "lon", name: "lon", type: "longitude", nullable: true },
      ],
    })!;
    expect(rowBox(located, { geometry: ROAD })).toEqual(geometryBox(ROAD));
    expect(rowBox(located, { lat: 38.5, lon: -9 })).toEqual({ west: -9, south: 38.5, east: -9, north: 38.5 });
    expect(rowBox(located, { name: "nowhere" })).toBeUndefined();
    expect(locatorFor({ fields: [{ id: "name", name: "name", type: "string", nullable: false }] })).toBeUndefined();
  });

  it("joins boxes outwards to the sixth decimal, and has none to join for rows with no place", () => {
    expect(unionBox([{ west: -9.1234567, south: 38.1234561, east: -9.1, north: 38.2 }, undefined, { west: -9.2, south: 38.3, east: -9.0000001, north: 38.4000001 }])).toEqual({
      west: -9.2,
      south: 38.123456,
      east: -9,
      north: 38.400001,
    });
    expect(unionBox([undefined, null])).toBeNull();
  });
});

describe("chunks of a located product", () => {
  const sink = (located: boolean) => ({ prefix: "serving/feed/places", known: new Set<string>(), located, put: async () => undefined });
  const placed = (id: string, latitude: number, longitude: number) => {
    const locator = locatorFor({ fields: [{ id: "geometry", name: "geometry", type: "geometry", nullable: true }] });
    return placedRow(id, JSON.stringify({ geometry: { type: "Point", coordinates: [longitude, latitude] }, id, _hash: "h" }), locator);
  };

  it("lists the box of its rows on each chunk, and none on the chunks of a product with no place", async () => {
    const rows = [placed("a", 38.7, -9.1), placed("b", 38.8, -9.2)];
    expect((await writeChunk(sink(true), rows)).box).toEqual({ west: -9.2, south: 38.7, east: -9.1, north: 38.8 });
    expect((await writeChunk(sink(true), [{ key: "c", json: '{"id":"c"}' }])).box).toBeNull();
    expect((await writeChunk(sink(false), [{ key: "c", json: '{"id":"c"}' }])).box).toBeUndefined();
  });

  it("orders rows by place, so a city's rows share chunks whatever their keys, and rows with no place come last", async () => {
    const rows = [
      placed("1", 38.71, -9.14),
      placed("2", 41.15, -8.61),
      placed("3", 38.72, -9.13),
      placed("4", 41.16, -8.62),
      { key: "0", json: '{"id":"0"}', order: spatialOrderKey(undefined, "0") },
    ];
    const ordered = rows.sort(compareRows).map((row) => row.key);
    expect(ordered.at(-1)).toBe("0");
    // Lisbon's two rows are neighbours in the order, and so are Porto's.
    expect(Math.abs(ordered.indexOf("1") - ordered.indexOf("3"))).toBe(1);
    expect(Math.abs(ordered.indexOf("2") - ordered.indexOf("4"))).toBe(1);
    const chunks = await buildChunks(rows, sink(true));
    expect(chunks[0]?.first).toMatch(/^[0-9a-f]{8}:/);
  });

  it("knows the product's extent only once every chunk has a box", () => {
    const chunk = (box: Box | null | undefined): ManifestChunk => {
      const listed: ManifestChunk = { key: "k", rows: 1, first: "a", last: "a" };
      if (box !== undefined) listed.box = box;
      return listed;
    };
    expect(extentOf([chunk({ west: 1, south: 2, east: 3, north: 4 }), chunk(null)])).toEqual({ west: 1, south: 2, east: 3, north: 4 });
    expect(extentOf([chunk(null)])).toBeNull();
    expect(extentOf([chunk({ west: 1, south: 2, east: 3, north: 4 }), chunk(undefined)])).toBeUndefined();
  });
});

describe("exact hits", () => {
  const at = (latitude: number, longitude: number, radius = 25) => ({ latitude, longitude, radius });

  it("finds a point inside a polygon, but not in its hole, nor outside it however near", () => {
    expect(hitTest(BLOCK_WITH_COURTYARD, at(38.72, -9.18))).toEqual({ inside: true, distance: 0 });
    expect(hitTest(BLOCK_WITH_COURTYARD, at(38.75, -9.15))).toBeUndefined();
    // Ten metres west of the block: polygons count only when they contain the point.
    expect(hitTest(BLOCK_WITH_COURTYARD, at(38.72, -9.2001, 1000))).toBeUndefined();
  });

  it("tests every part of a multipolygon, holes included", () => {
    expect(hitTest(TWO_PARCELS, at(41.15, -8.65))?.inside).toBe(true);
    expect(hitTest(TWO_PARCELS, at(41.12, -8.48))?.inside).toBe(true);
    expect(hitTest(TWO_PARCELS, at(41.15, -8.45))).toBeUndefined();
    expect(hitTest(TWO_PARCELS, at(41.15, -8.55))).toBeUndefined();
  });

  it("measures points and lines and keeps those within the radius", () => {
    const beside = hitTest(ROAD, at(38.005, -8.9997, 30));
    expect(beside?.inside).toBe(false);
    expect(beside?.distance).toBeCloseTo(metresEast(0.0003, 38.005), 0);
    expect(hitTest(ROAD, at(38.005, -8.9997, 25))).toBeUndefined();
    // Past the end of the line it is the distance to its last vertex.
    expect(hitTest(ROAD, at(38.0101, -9.0, 25))?.distance).toBeCloseTo(0.0001 * METRES_PER_DEGREE, 0);
    expect(hitTest({ type: "Point", coordinates: [-9.0, 38.0] }, at(38.0, -9.0, 0))).toEqual({ inside: false, distance: 0 });
    expect(
      hitTest(
        {
          type: "MultiPoint",
          coordinates: [
            [-9.1, 38.0],
            [-9.0001, 38.0],
          ],
        },
        at(38.0, -9.0, 25),
      )?.distance,
    ).toBeCloseTo(metresEast(0.0001, 38), 0);
  });

  it("keeps everything the measurement accepts inside the box it reads, at any latitude", () => {
    for (const latitude of [0, 38.7, 60, 89, 89.6, 89.9999, -89.9999]) {
      const query = { latitude, longitude: -9, radius: 1000 };
      const box = queryBox(query);
      // Candidate points all round the query, from the edge of the radius out to fifty degrees east and west.
      for (const east of [0, 1e-4, 1e-3, 0.01, 0.1, 1, 10, 50, -50]) {
        for (const north of [0, 0.005, 0.00899, -0.00899]) {
          const candidate = { type: "Point", coordinates: [-9 + east, Math.max(-90, Math.min(90, latitude + north))] };
          if (hitTest(candidate, query)) expect(boxesIntersect(geometryBox(candidate)!, box), `${latitude} ${east} ${north}`).toBe(true);
        }
      }
    }
    // Next to a pole a degree of longitude is metres long; the measurement no longer counts fifty of them as near.
    expect(hitTest({ type: "Point", coordinates: [41, 89.9999] }, { latitude: 89.9999, longitude: -9, radius: 25 })).toBeUndefined();
  });

  it("widens the point by the radius for the box a chunk or a row must reach", () => {
    const box = queryBox({ latitude: 38, longitude: -9, radius: 1000 });
    expect(box.north - 38).toBeGreaterThan(1000 / METRES_PER_DEGREE);
    expect(box.east + 9).toBeGreaterThan(1000 / (METRES_PER_DEGREE * Math.cos((38 * Math.PI) / 180)));
  });
});

/* ---------- One product, looked up ---------- */

const GEOMETRY_FIELDS: Array<{ name: string; type: FieldType }> = [
  { name: "name", type: "string" },
  { name: "geometry", type: "geometry" },
];

/** A product whose chunks were each built from one group of records, so a test decides what each chunk holds. */
async function product(groups: JsonObject[][], options: { fields?: Array<{ name: string; type: FieldType }>; indexed?: boolean } = {}) {
  const snapshots = new MemorySnapshots();
  const objects = new ObjectStore(snapshots);
  const schema = { fields: (options.fields ?? GEOMETRY_FIELDS).map((field) => ({ id: field.name, nullable: true, ...field })) };
  const locator = locatorFor(schema);
  const indexed = options.indexed ?? true;
  const chunks: ManifestChunk[] = [];
  for (const group of groups) {
    const rows = group.map((record) => placedRow(String(record.id), JSON.stringify({ ...record, _hash: "h", _time: {} }), indexed ? locator : undefined)).sort(compareRows);
    chunks.push(
      ...(await buildChunks(rows, {
        prefix: keys.prefix("feed_1", "places"),
        known: new Set(),
        located: indexed && locator !== undefined,
        put: async (key, body) => {
          await objects.writeText(key, body);
        },
      })),
    );
  }
  const extent = indexed && locator ? extentOf(chunks) : undefined;
  const detail: ProductDetail = {
    id: "prd_1",
    slug: "places",
    feedId: "feed_1",
    productKey: "places",
    title: "Places",
    description: "test",
    role: "reference",
    kind: "record",
    schema,
    updateMode: "authoritative-snapshot",
    completeness: "complete",
    version: 1,
    status: "current",
    currentAcquisitionId: "acq_1",
    watermark: null,
    rowCount: groups.flat().length,
    chunks,
    changesKey: null,
    seriesKey: null,
    seriesChangesKey: null,
    updatedAt: "2026-10-06T00:00:00.000Z",
    createdAt: "2026-10-06T00:00:00.000Z",
    stale: false,
    exposeHistory: false,
    historyMode: "latest",
    licence: { id: "cc-by-4.0", name: "CC BY 4.0" },
    attribution: "Fixture publisher",
    staleAfterSeconds: 3600,
    cadenceSeconds: 3600,
  };
  setExtent(detail, extent);
  const service = new Serving({ listProducts: async () => [detail], getProduct: async (slug) => (slug === detail.slug ? detail : undefined) }, objects);
  return { detail, service, snapshots };
}

const lisbon = [
  { id: "block", name: "Block", geometry: BLOCK_WITH_COURTYARD },
  { id: "kiosk", name: "Kiosk", geometry: { type: "Point", coordinates: [-9.18, 38.72005] } },
  { id: "far-kiosk", name: "Far kiosk", geometry: { type: "Point", coordinates: [-9.18, 38.73] } },
];
const porto = [{ id: "parcels", name: "Parcels", geometry: TWO_PARCELS }];
const south = [{ id: "road", name: "Road", geometry: ROAD }];

/** One page of a product's records at a point, as `/records?lat&lon` asks for it. */
function at(
  service: Serving,
  detail: ProductDetail,
  latitude: number,
  longitude: number,
  options: { radius?: number; limit?: number; cursor?: string; where?: Array<{ field: string; value: string }> } = {},
) {
  const query: RecordQuery = { limit: options.limit ?? 10, filters: { point: { latitude, longitude, radius: options.radius ?? 25 } } };
  if (options.where && query.filters) query.filters.where = options.where;
  if (options.cursor) query.cursor = options.cursor;
  return service.records(detail, query);
}

describe("one product's records at a point", () => {
  it("reads only the chunk whose box holds the point, polygons that contain it first, then the nearest", async () => {
    const { detail, service, snapshots } = await product([lisbon, porto, south]);
    expect(detail.chunks).toHaveLength(3);
    const reads = snapshots.reads;
    const found = await at(service, detail, 38.72, -9.18);
    expect(snapshots.reads - reads).toBe(1);
    // The polygon that contains the point first, then the kiosk 5.6 m away; the far kiosk is past the radius.
    expect(found.data.map((row) => row.id)).toEqual(["block", "kiosk"]);
    expect(found.data[0]?._distance).toBe(0);
    expect(found.data[1]?._distance).toBeCloseTo(0.00005 * METRES_PER_DEGREE, 0);
    expect(found.point).toEqual({ matched: 2, indexed: true, complete: true });
    expect(found.nextCursor).toBeUndefined();
    // A records page serves the whole record, geometry included, and never the row hash.
    expect(found.data[0]?.geometry).toEqual(BLOCK_WITH_COURTYARD);
    expect(found.data[0]?._hash).toBeUndefined();
  });

  it("reads nothing where no chunk reaches, and finds nothing in a courtyard or a hole", async () => {
    const { detail, service, snapshots } = await product([lisbon, porto, south]);
    const reads = snapshots.reads;
    expect((await at(service, detail, 40.0, -7.0)).data).toEqual([]);
    expect(snapshots.reads).toBe(reads);
    expect((await at(service, detail, 38.75, -9.15)).data).toEqual([]);
    expect((await at(service, detail, 41.15, -8.45)).data).toEqual([]);
    expect((await at(service, detail, 41.12, -8.48)).data.map((row) => row.id)).toEqual(["parcels"]);
  });

  it("finds lines within the radius, and only within it", async () => {
    const { detail, service } = await product([lisbon, porto, south]);
    expect((await at(service, detail, 38.005, -8.9997, { radius: 30 })).data.map((row) => row.id)).toEqual(["road"]);
    expect((await at(service, detail, 38.005, -8.9997, { radius: 20 })).data).toEqual([]);
  });

  it("pages nearest first with a cursor, every match once, and says how many matched in all", async () => {
    const crowd = Array.from({ length: 30 }, (_, index) => ({
      id: `stop-${String(index).padStart(2, "0")}`,
      name: index % 2 === 0 ? "Bus" : "Tram",
      geometry: { type: "Point", coordinates: [-9.1, 38.7 + index * 0.00001] },
    }));
    // Spread over three chunks, so the order is the distance's and not the chunks'.
    const { detail, service } = await product([crowd.slice(20), crowd.slice(0, 10), crowd.slice(10, 20)]);
    const first = await at(service, detail, 38.7, -9.1, { radius: 100, limit: 5 });
    expect(first.data.map((row) => row.id)).toEqual(["stop-00", "stop-01", "stop-02", "stop-03", "stop-04"]);
    expect(first.point?.matched).toBe(30);
    const seen = first.data.map((row) => String(row.id));
    let cursor = first.nextCursor;
    while (cursor) {
      const page = await at(service, detail, 38.7, -9.1, { radius: 100, limit: 5, cursor });
      seen.push(...page.data.map((row) => String(row.id)));
      cursor = page.nextCursor;
    }
    expect(seen).toEqual(crowd.map((stop) => stop.id));
    // `where` applies to the same rows, and the count is of what passes both.
    const buses = await at(service, detail, 38.7, -9.1, { radius: 100, limit: 50, where: [{ field: "name", value: "Bus" }] });
    expect(buses.data.every((row) => row.name === "Bus")).toBe(true);
    expect(buses.point?.matched).toBe(15);
  });

  it("refuses a cursor from another kind of page, or another version", async () => {
    const { detail, service } = await product([lisbon]);
    await expect(at(service, detail, 38.72, -9.18, { cursor: "v1:0:3" })).rejects.toBeInstanceOf(InvalidQueryError);
    await expect(at(service, detail, 38.72, -9.18, { cursor: "v0:at:3" })).rejects.toThrow(/version/);
    await expect(service.records(detail, { limit: 10, cursor: "v1:at:3" })).rejects.toBeInstanceOf(InvalidQueryError);
  });

  it("reads at most the bounded number of chunks, and says the answer is incomplete when more reach the point", async () => {
    const groups = Array.from({ length: POINT_LOOKUP.maxChunks + 2 }, (_, index) => [
      { id: `p${index}`, name: "Same place", geometry: { type: "Point", coordinates: [-9.1, 38.7] } },
    ]);
    const { detail, service, snapshots } = await product(groups);
    const reads = snapshots.reads;
    const found = await at(service, detail, 38.7, -9.1);
    expect(snapshots.reads - reads).toBe(POINT_LOOKUP.maxChunks);
    expect(found.point).toMatchObject({ matched: POINT_LOOKUP.maxChunks, complete: false });
  });

  it("reads a product not indexed yet whole when it is small, and says so", async () => {
    const { detail, service, snapshots } = await product([lisbon, porto, south], { indexed: false });
    expect(detail.extent).toBeUndefined();
    const reads = snapshots.reads;
    const found = await at(service, detail, 38.72, -9.18);
    expect(snapshots.reads - reads).toBe(3);
    expect(found.data.map((row) => row.id)).toEqual(["block", "kiosk"]);
    expect(found.point).toMatchObject({ indexed: false, complete: true });
  });

  it("refuses to guess about a product not indexed yet that is too large to read whole", async () => {
    const groups = Array.from({ length: POINT_LOOKUP.maxChunks + 1 }, (_, index) => [
      { id: `p${index}`, name: "Somewhere", geometry: { type: "Point", coordinates: [-9 + index, 38] } },
    ]);
    const { detail, service } = await product(groups, { indexed: false });
    await expect(at(service, detail, 38, -9)).rejects.toBeInstanceOf(NotIndexedError);
    await expect(service.geoJson(detail, { point: { latitude: 38, longitude: -9, radius: 25 } })).rejects.toBeInstanceOf(NotIndexedError);
  });

  it("refuses a point on a product with no place, as bbox is refused there", async () => {
    const { detail, service } = await product([[{ id: "a", name: "A" }]], { fields: [{ name: "name", type: "string" }] });
    await expect(at(service, detail, 38, -9)).rejects.toBeInstanceOf(InvalidQueryError);
    await expect(service.records(detail, { limit: 10, filters: { bbox: { west: -10, south: 37, east: -8, north: 39 } } })).rejects.toBeInstanceOf(InvalidQueryError);
    expect(productExtent(detail)).toBeNull();
  });

  it("looks a latitude/longitude product up by its coordinates", async () => {
    const fields: Array<{ name: string; type: FieldType }> = [
      { name: "name", type: "string" },
      { name: "lat", type: "latitude" },
      { name: "lon", type: "longitude" },
    ];
    const { detail, service } = await product([[{ id: "stop", name: "Stop", lat: 38.7, lon: -9.1 }]], { fields });
    expect(productExtent(detail)).toEqual({ bbox: [-9.1, 38.7, -9.1, 38.7], indexed: true });
    expect((await at(service, detail, 38.7001, -9.1)).data).toMatchObject([{ id: "stop", lat: 38.7, lon: -9.1 }]);
  });

  it("streams the same features as GeoJSON from the same chunks, each with its distance", async () => {
    const { detail, service, snapshots } = await product([lisbon, porto, south]);
    const reads = snapshots.reads;
    const collection = jsonAs<{ indexed: boolean; complete: boolean; numberMatched?: number; numberReturned: number; features: Array<{ id: string; properties: JsonObject }> }>(
      await new Response(await service.geoJson(detail, { point: { latitude: 38.72, longitude: -9.18, radius: 25 } })).text(),
    );
    expect(snapshots.reads - reads).toBe(1);
    expect(collection.features.map((feature) => feature.id).sort()).toEqual(["block", "kiosk"]);
    expect(collection.features.find((feature) => feature.id === "block")?.properties._distance).toBe(0);
    expect(collection).toMatchObject({ indexed: true, complete: true, numberReturned: 2 });
    expect(collection.numberMatched).toBeUndefined();
  });
});

describe("the products at a point", () => {
  const listed = (slug: string, extent: Product["extent"]): Product => ({
    id: slug,
    slug,
    feedId: "feed_1",
    title: slug,
    description: slug,
    role: "reference",
    schema: { fields: [] },
    version: 1,
    status: "current",
    currentAcquisitionId: null,
    watermark: null,
    rowCount: 1,
    completeness: "complete",
    stale: false,
    staleAfterSeconds: 3600,
    cadenceSeconds: 3600,
    historyMode: "latest",
    exposeHistory: false,
    licence: null,
    attribution: null,
    hasChanges: false,
    hasSeries: false,
    extent,
    updatedAt: "2026-10-06T00:00:00.000Z",
  });

  it("lists the products whose extent reaches the point, and names those not indexed yet apart", () => {
    const products = [
      listed("lisbon-parcels", { bbox: [-9.25, 38.65, -9.05, 38.85], indexed: true }),
      listed("porto-parcels", { bbox: [-8.7, 41.1, -8.5, 41.2], indexed: true }),
      listed("stations", { bbox: [-9.2, 38.7, -9.18, 38.71], indexed: true }),
      listed("crus-somewhere", { bbox: null, indexed: false }),
      listed("prices", null),
    ];
    const at = (latitude: number, longitude: number, radius: number) => productsAt(products, { latitude, longitude, radius });
    const here = at(38.72, -9.15, 25);
    expect(here.data.map((product) => product.slug)).toEqual(["lisbon-parcels"]);
    expect(here.notIndexed).toEqual(["crus-somewhere"]);
    expect(here.point).toEqual({ lat: 38.72, lon: -9.15 });
    // A radius reaches products whose extent stops just short of the point.
    expect(at(38.7105, -9.1795, 0).data.map((product) => product.slug)).toEqual(["lisbon-parcels"]);
    expect(at(38.7105, -9.1795, 100).data.map((product) => product.slug)).toEqual(["lisbon-parcels", "stations"]);
  });
});
