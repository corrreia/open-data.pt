import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  NORMALIZED_PROTOCOL,
  collectNormalized,
  isJsonObject,
  isJsonString,
  parseJson,
  type CanonicalRecord,
  type CollectionRequest,
  type JsonObject,
  type JsonValue,
  type ProductDeclaration,
  type SeriesPoint,
  type StreamingSummary,
  type TransformContext,
} from "@open-data-pt/gatekeeper";
import type { CkanResourceMetadata } from "../apps/gatekeeper/src/formats/ckan/ckan";
import { CKAN_NORMALIZER, CKAN_SAMPLE_ROWS, epsg3763ToWgs84, parsePythonLiteral, transformCkan } from "../apps/gatekeeper/src/formats/ckan/transform";
import { ckanCollector } from "../apps/gatekeeper/src/formats/ckan";

const context: TransformContext = {
  feed: {
    id: "feed_ckan",
    slug: "porto-resource-feed",
    title: "Porto resource",
    description: "test feed",
    config: {
      host: "opendata.porto.digital",
      dataset: "example-dataset",
    },
    semantics: {
      boundedness: "bounded",
      changeSemantics: "full-snapshot",
      cadence: "periodic",
      domainSubject: "reference",
      defaultProductRole: "reference",
      completeness: "complete",
      ordering: "none",
    },
  },
  observedAt: "2026-09-07T17:46:23Z",
  sourcePublishedAt: "2026-03-18T03:25:30.243Z",
};

/** One resource as the transform receives it: body text plus the metadata the source captured. */
interface ResourceInput {
  text: string;
  metadata: CkanResourceMetadata;
}

/** Everything a streaming transform produced, read to the end. */
interface Transformed {
  products: ProductDeclaration[];
  records: CanonicalRecord[];
  points: SeriesPoint[];
  summary: StreamingSummary;
}

function streamOf(text: string, chunkSize: number): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
}

async function run(input: ResourceInput, chunkSize = 97): Promise<Transformed> {
  const transform = await transformCkan(streamOf(input.text, chunkSize), context, input.metadata);
  const records: CanonicalRecord[] = [];
  const points: SeriesPoint[] = [];
  for await (const row of transform.rows) {
    if (row.record !== undefined) records.push(row.record);
    else points.push(row.point);
  }
  return { products: transform.products, records, points, summary: transform.finish() };
}

/** The recorded Porto fixtures keep the old collected-document layout: split it into metadata and body. */
function fixture(name: string): ResourceInput {
  const document = parseJson(readFileSync(new URL(`./fixtures/ckan/${name}`, import.meta.url), "utf8"));
  if (!isJsonObject(document) || !isJsonObject(document.package) || !isJsonObject(document.resource) || !isJsonString(document.body)) {
    throw new Error(`${name} is not a CKAN fixture`);
  }
  return { text: document.body, metadata: { package: document.package, resource: document.resource, source: { kind: "file", format: "csv" } } };
}

function file(format: "csv" | "geojson" | "json", text: string, packageMetadata: JsonObject = { name: "labels" }): ResourceInput {
  return { text, metadata: { package: packageMetadata, resource: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }, source: { kind: "file", format } } };
}

function datastoreResource(packageMetadata: JsonObject, resource: JsonObject, fields: JsonValue[], records: JsonValue[]): ResourceInput {
  return {
    text: records.map((record) => JSON.stringify(record)).join("\n"),
    metadata: { package: packageMetadata, resource, source: { kind: "datastore", fields } },
  };
}

function datastore(field: string, value: JsonValue, resource: JsonObject = {}): ResourceInput {
  return datastoreResource(
    { name: "geometry-test" },
    { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", ...resource },
    [
      { id: "_id", type: "int" },
      { id: field, type: "text" },
    ],
    [{ _id: 7, [field]: value }],
  );
}

function distanceMetres(actual: { latitude: number; longitude: number }, expected: { latitude: number; longitude: number }): number {
  const radians = (value: number) => (value * Math.PI) / 180;
  const latitudeDelta = radians(expected.latitude - actual.latitude);
  const longitudeDelta = radians(expected.longitude - actual.longitude);
  const a = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(radians(actual.latitude)) * Math.cos(radians(expected.latitude)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const SENSOR_READINGS = datastoreResource(
  { name: "sensor-readings", title: "Sensor readings" },
  { id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", name: "Readings" },
  [
    { id: "_id", type: "int" },
    { id: "station", type: "text" },
    { id: "status", type: "text" },
    { id: "color", type: "text" },
    { id: "latitude", type: "numeric" },
    { id: "longitude", type: "numeric" },
    { id: "reading", type: "float" },
    { id: "measured_at", type: "timestamp" },
    { id: "installed_on", type: "date" },
    { id: "active", type: "text" },
    { id: "metadata", type: "json" },
    { id: "website", type: "text" },
  ],
  [
    {
      _id: 1,
      station: "A",
      status: "good",
      color: "#00aa44",
      latitude: "41.15",
      longitude: "-8.61",
      reading: "12.5",
      measured_at: "2026-09-07T10:00:00Z",
      installed_on: "2024-01-02",
      active: "sim",
      metadata: { pollutant: "NO2" },
      website: "https://example.test/a",
    },
    {
      _id: 2,
      station: "A",
      status: "warning",
      color: "#ffaa00",
      latitude: 41.15,
      longitude: -8.61,
      reading: 15,
      measured_at: "2026-09-07T11:00:00Z",
      installed_on: "2024-01-02",
      active: "não",
      metadata: { pollutant: "NO2" },
      website: "https://example.test/a",
    },
  ],
);

describe("CKAN transformers", () => {
  it("uses the current normalizer version and streams the live Porto parking fixture byte by byte", async () => {
    const result = await run(fixture("parking-csv.json"), 1);
    const product = result.products[0];

    expect(CKAN_NORMALIZER).toEqual({ id: "ckan-resource", version: "6" });
    expect(product).toMatchObject({
      role: "reference",
      updateMode: "authoritative-snapshot",
    });
    expect(result.summary.quality).toMatchObject({ acceptedRecords: 3, rejectedRecords: 0 });
    expect(result.records[0]?.payload).toMatchObject({
      designacao: "Caminhos do Romântico",
      latitude: expect.closeTo(41.14868673287119, 12),
      longitude: expect.closeTo(-8.628926854993097, 12),
      nº_lugares_ligeiros: 105,
    });
    expect(result.records[0]?.payload).not.toHaveProperty("esriGeometryPoint");
    expect(product?.schema.fields.find((field) => field.name === "latitude")?.type).toBe("latitude");
    expect(product?.schema.fields.find((field) => field.name === "longitude")?.type).toBe("longitude");
    expect(product?.schema.fields.find((field) => field.id === "nº_lugares_ligeiros")).toMatchObject({
      name: "nº_lugares_ligeiros",
      type: "number",
      display: { label: "Nº lugares ligeiros" },
    });
  });

  it("implements the EPSG:3763 inverse Transverse Mercator accurately", () => {
    const liveParking = epsg3763ToWgs84(-41_621.9676, 164_508.9791);
    expect(
      distanceMetres(liveParking, {
        latitude: 41.14868673161428,
        longitude: -8.628926854990661,
      }),
    ).toBeLessThan(0.25);

    // The task's stated city-hall WGS84 position corresponds to approximately
    // (-40108, 164602) in EPSG:3763 (not the stated (-41500, 165500)).
    const cityHall = epsg3763ToWgs84(-40_108, 164_602);
    expect(distanceMetres(cityHall, { latitude: 41.1496, longitude: -8.6109 })).toBeLessThan(20);

    const statedProjectedPair = epsg3763ToWgs84(-41_500, 165_500);
    expect(statedProjectedPair).toEqual({
      latitude: expect.closeTo(41.157616188731424, 10),
      longitude: expect.closeTo(-8.627541017629653, 10),
    });
  });

  it.each([
    {
      field: "esriGeometryPoint",
      value: "-41621.96760000009,164508.9791000001",
      type: undefined,
    },
    {
      field: "esriGeometryPolyline",
      value: {
        paths: [
          [
            [-41_621.9676, 164_508.9791],
            [-39_877.7826, 163_844.745],
          ],
        ],
      },
      type: "LineString",
    },
    {
      field: "esriGeometryPolygon",
      value: JSON.stringify({
        rings: [
          [
            [-41_621, 164_508],
            [-41_600, 164_508],
            [-41_600, 164_530],
            [-41_621, 164_508],
          ],
        ],
      }),
      type: "Polygon",
    },
    {
      field: "esriGeometryMultipoint",
      value: "{'points': [[-41621.9676, 164508.9791], [-39877.7826, 163844.745]], 'spatialReference': {'wkid': 3763}}",
      type: "MultiPoint",
    },
  ])("detects and converts $field", async ({ field, value, type }) => {
    const result = await run(datastore(field, value));
    const product = result.products[0];
    const payload = result.records[0]?.payload;

    expect(result.records[0]?.entityKey).toBe("7");
    expect(payload?.latitude).toBeTypeOf("number");
    expect(payload?.longitude).toBeTypeOf("number");
    expect(product?.schema.fields.some((item) => item.id === field)).toBe(false);
    if (type) {
      expect(payload?.geometry).toMatchObject({ type });
      expect(product?.schema.fields.find((item) => item.id === "geometry")?.type).toBe("geometry");
    } else {
      expect(payload).not.toHaveProperty("geometry");
    }
  });

  it("detects a projected x,y column without an ArcGIS field name", async () => {
    const result = await run(datastore("position", "-41621.9676,164508.9791", { crs: "EPSG:3763" }));
    const payload = result.records[0]?.payload;
    expect(payload).toMatchObject({
      latitude: expect.closeTo(41.1486867, 6),
      longitude: expect.closeTo(-8.6289269, 6),
    });
    expect(payload).not.toHaveProperty("position");
  });

  it.each(["esriGeometryPoint", "coordinates"])("keeps WGS84 JSON point values from %s as longitude and latitude", async (field) => {
    const result = await run(datastore(field, { x: -8.6109, y: 41.1496 }));
    expect(result.records[0]?.payload).toMatchObject({
      latitude: 41.1496,
      longitude: -8.6109,
    });
  });

  it("parses safe Python-style literals without evaluating them", () => {
    expect(parsePythonLiteral(String.raw`{'quote': 'it\'s', "nested": [True, False, None, {'x': 1.5}], 'escaped': 'line\nnext'}`)).toEqual({
      quote: "it's",
      nested: [true, false, null, { x: 1.5 }],
      escaped: "line\nnext",
    });
    expect(parsePythonLiteral("{'trailing': [1, 2,],}")).toEqual({ trailing: [1, 2] });
    expect(parsePythonLiteral("{'broken': [1, 2}")).toBeNull();
    expect(parsePythonLiteral("__import__('node:fs')")).toBeNull();
  });

  it("selects multilingual text and preserves i18n, dates, and nested coordinates", async () => {
    const result = await run(
      datastoreResource(
        { name: "events" },
        { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
        [
          { id: "_id", type: "int" },
          { id: "label", type: "text" },
          { id: "dates", type: "text" },
          { id: "location", type: "text" },
        ],
        [
          {
            _id: 1,
            label: "[{'lang': 'en-GB', 'value': 'Event'}, {'lang': 'pt-PT', 'value': 'Evento'}]",
            dates: "{'start': '2026-09-07T10:00:00Z', 'end': '2026-09-07T11:00:00Z'}",
            location: "{'name': 'Aliados', 'position': {'lat': 41.1496, 'lon': -8.6109}}",
          },
          {
            _id: 2,
            label: "[{'lang': 'en-GB', 'value': 'Exhibition'}]",
            dates: "{'start': '2026-09-08T10:00:00Z', 'end': '2026-09-08T11:00:00Z'}",
            location: "{'position': {'latitude': 41.15, 'longitude': -8.61}}",
          },
          {
            _id: 3,
            label: "[{'lang': 'fr-FR', 'value': 'Concert'}]",
            dates: "{'start': '2026-09-09T10:00:00Z', 'end': '2026-09-09T11:00:00Z'}",
            location: "{'position': {'lat': 41.16, 'lng': -8.62}}",
          },
        ],
      ),
      7,
    );
    const product = result.products[0];

    expect(result.records.map((record) => record.payload.label)).toEqual(["Evento", "Exhibition", "Concert"]);
    expect(result.records[0]?.payload).toMatchObject({
      label_i18n: [
        { lang: "en-GB", value: "Event" },
        { lang: "pt-PT", value: "Evento" },
      ],
      dates_start: "2026-09-07T10:00:00.000Z",
      dates_end: "2026-09-07T11:00:00.000Z",
      latitude: 41.1496,
      longitude: -8.6109,
    });
    expect(product?.schema.fields.find((field) => field.id === "label")?.type).toBe("string");
    expect(product?.schema.fields.find((field) => field.id === "label_i18n")?.type).toBe("json");
    expect(product?.schema.fields.find((field) => field.id === "dates_start")?.type).toBe("datetime");
    // The first date column is dates_end (derived columns are inserted after their source, latest first).
    expect(result.summary.products?.[0]).toMatchObject({ productKey: "records", watermark: "2026-09-09T11:00:00.000Z" });
  });

  it.each(["parking-csv.json", "trees-csv.json", "cultural-agenda-csv.json", "museums-csv.json"])("turns live example fixture %s into a mappable product", async (name) => {
    const result = await run(fixture(name));
    const fields = result.products[0]?.schema.fields ?? [];
    expect(fields.find((field) => field.type === "latitude")).toBeDefined();
    expect(fields.find((field) => field.type === "longitude")).toBeDefined();
    expect(result.summary.quality).toMatchObject({ acceptedRecords: 3, rejectedRecords: 0 });
  });

  it("parses the live cultural fixtures as typed multilingual records", async () => {
    for (const result of [await run(fixture("cultural-agenda-csv.json")), await run(fixture("museums-csv.json"), 5)]) {
      const product = result.products[0];
      expect(product?.schema.fields.find((field) => field.id === "active")?.type).toBe("boolean");
      expect(product?.schema.fields.find((field) => field.id === "category")?.type).toBe("string");
      expect(product?.schema.fields.find((field) => field.id === "category_i18n")?.type).toBe("json");
      expect(result.records[0]?.payload.active).toBe(true);
      expect(result.records[0]?.payload.category).toBeTypeOf("string");
      expect(result.records[0]?.payload.category_i18n).toBeInstanceOf(Array);
    }
  });

  it("maps DataStore types, keeps _id as identity, adds a colour badge, and publishes only the table", async () => {
    const result = await run(SENSOR_READINGS);

    expect(result.records.map((record) => record.entityKey)).toEqual(["1", "2"]);
    expect(result.records[0]?.payload).toMatchObject({
      latitude: 41.15,
      longitude: -8.61,
      reading: 12.5,
      measured_at: "2026-09-07T10:00:00.000Z",
      installed_on: "2024-01-02",
      active: true,
      metadata: { pollutant: "NO2" },
    });
    const reference = result.products[0];
    expect(reference?.schema.fields.find((field) => field.name === "station")).toMatchObject({
      type: "category",
      display: { badge: { colorField: "color" } },
    });
    expect(reference?.schema.fields.find((field) => field.name === "website")?.type).toBe("url");
    // Numeric columns are not guessed into time series: the resource is published once, as its table.
    expect(result.products.map((product) => product.productKey)).toEqual(["records"]);
    expect(result.points).toEqual([]);
    expect(result.summary.products).toEqual([expect.objectContaining({ productKey: "records", watermark: "2026-09-07T11:00:00.000Z" })]);
  });

  it("computes GeoJSON polygon centroids and preserves null geometry", async () => {
    const collection = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { id: "triangle" },
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [0, 0],
                [4, 0],
                [0, 2],
                [0, 0],
              ],
            ],
          },
        },
        { type: "Feature", properties: { id: "unknown-location" }, geometry: null },
        { type: "Feature", properties: { id: "broken" }, geometry: "nowhere" },
      ],
    });
    const result = await run(file("geojson", collection, { name: "areas", title: "Areas" }), 1);

    expect(result.records[0]?.payload).toMatchObject({
      centroidLongitude: 4 / 3,
      centroidLatitude: 2 / 3,
    });
    expect(result.products[0]?.schema.fields.find((field) => field.name === "geometry")).toMatchObject({ type: "geometry", nullable: true });
    expect(result.summary.quality).toMatchObject({ acceptedRecords: 2, rejectedRecords: 1 });
    await expect(run(file("geojson", '{"type": "Feature", "features": []}'))).rejects.toThrow("FeatureCollection");
  });

  it("reads every JSON layout: an array, a records member, a FeatureCollection, or one object", async () => {
    const array = await run(file("json", '[{"id": "a", "n": 1}, 7, {"id": "b", "n": 2}]'), 3);
    expect(array.records.map((record) => record.entityKey)).toEqual(["a", "b"]);
    expect(array.summary.quality).toMatchObject({ acceptedRecords: 2, rejectedRecords: 1 });

    const members = await run(file("json", '{"help": "x", "records": [{"id": "c"}], "total": 1}'), 4);
    expect(members.records.map((record) => record.payload)).toEqual([{ id: "c" }]);

    const features = await run(file("json", '{"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {"id": "f"}, "geometry": null}]}'));
    expect(features.records[0]?.payload).toMatchObject({ id: "f", geometry: null });

    const single = await run(file("json", '{"id": "only", "tags": ["a"]}'), 2);
    expect(single.records).toEqual([{ entityKey: "only", payload: { id: "only", tags: ["a"] } }]);
  });

  it("preserves significant CSV whitespace, reads RFC 4180 details and rejects rows of the wrong width", async () => {
    const labels = await run(file("csv", 'id,label\r\n1,"  Porto  "\r\n2,\'tis\r\n3\r\n'), 1);
    expect(labels.records.map((record) => record.payload.label)).toEqual(["  Porto  ", "'tis"]);
    expect(labels.summary.quality).toMatchObject({ acceptedRecords: 2, rejectedRecords: 1 });

    const notes = await run(file("csv", 'id;label;note\r\n1;"A; B";"line one\nline ""two"""\r\n'), 2);
    expect(notes.records[0]?.payload).toMatchObject({ label: "A; B", note: 'line one\nline "two"' });
  });

  it("reads the exporter's single-quote dialect across chunk boundaries", async () => {
    const result = await run(file("csv", "'id','label','note'\r\n'1','it''s, \"quoted\"','two\nlines'\r\n'2','',\"x\"\r\n"), 1);
    expect(result.records.map((record) => record.payload)).toEqual([
      { id: "1", label: 'it\'s, "quoted"', note: "two\nlines" },
      { id: "2", label: null, note: "x" },
    ]);
  });

  it("applies sampled column decisions to later rows and reports what they showed at the end", async () => {
    const rows = Array.from({ length: CKAN_SAMPLE_ROWS }, (_, index) => `r${index},${index}.5`);
    const text = ["code,amount", ...rows, "late,n/a", "blank,", "last,3"].join("\n");
    const result = await run(file("csv", text), 4096);

    expect(result.products[0]?.schema.fields.find((field) => field.name === "amount")).toMatchObject({ type: "number", nullable: false });
    expect(result.records).toHaveLength(CKAN_SAMPLE_ROWS + 3);
    expect(result.records.at(-3)?.payload).toEqual({ code: "late", amount: null });
    expect(result.records.at(-1)?.payload).toEqual({ code: "last", amount: 3 });
    expect(result.summary.products?.[0]?.schema?.fields.find((field) => field.name === "amount")).toMatchObject({ type: "number", nullable: true });

    const lateKey = JSON.stringify([...Array.from({ length: CKAN_SAMPLE_ROWS }, (_, index) => ({ id: `k${index}` })), { id: "extra", note: "new" }]);
    const late = await run(file("json", lateKey), 8192);
    expect(late.products[0]?.schema.fields.map((field) => field.name)).toEqual(["id"]);
    expect(late.records.at(-1)?.payload).toEqual({ id: "extra", note: "new" });
    expect(late.summary.products?.[0]?.schema?.fields.map((field) => [field.name, field.nullable])).toEqual([
      ["id", false],
      ["note", true],
    ]);
  });
});

describe("CKAN streaming through the shared collector", () => {
  it("frames a DataStore table as header and record frames, then the final schema and watermark", async () => {
    const fields = SENSOR_READINGS.metadata.source.kind === "datastore" ? SENSOR_READINGS.metadata.source.fields : [];
    const records = SENSOR_READINGS.text.split("\n").map((line) => parseJson(line));
    const resourceId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const fetcher = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(input.toString());
      if (url.pathname.endsWith("/package_show")) {
        return Response.json({
          success: true,
          result: {
            name: "sensor-readings",
            title: "Sensor readings",
            metadata_modified: "2026-09-07T12:00:00Z",
            resources: [{ id: resourceId, name: "Readings", format: "CSV", url: "https://opendata.porto.digital/readings.csv", datastore_active: true }],
          },
        });
      }
      const limit = Number(url.searchParams.get("limit"));
      return Response.json({ success: true, result: { fields, records: limit === 0 ? [] : records, total: records.length } });
    });
    const collector = ckanCollector({ config: { host: "opendata.porto.digital", dataset: "sensor-readings", resource: resourceId }, hosts: "opendata.porto.digital", fetcher });
    const resolved = await collector.resolve({ host: "opendata.porto.digital", dataset: "sensor-readings", resource: resourceId });
    const request: CollectionRequest = {
      protocol: NORMALIZED_PROTOCOL,
      collectionId: "collection_1",
      feed: { id: "feed_1", slug: "porto-sensors-feed", title: "Porto sensors", description: "Sensor readings" },
      resolved,
      feedEpoch: "epoch-1",
      mode: { kind: "live" },
      limits: { sourceBytes: 1024 * 1024, outputBytes: 4 * 1024 * 1024, frameBytes: 256 * 1024, recordBytes: 128 * 1024, records: 10_000, products: 4 },
      deadline: new Date(Date.now() + 30_000).toISOString(),
      observedAt: "2026-09-10T12:00:00.000Z",
    };

    const result = await collectNormalized(request, collector);
    if (result.kind !== "batch") throw new Error(`Expected a batch, got ${result.kind}`);
    const frames = (await new Response(result.stream).text())
      .trim()
      .split("\n")
      .map((line) => parseJson(line));

    expect(frames[0]).toMatchObject({
      type: "header",
      normalizer: { id: "ckan-resource", version: "6" },
      provenance: {
        sourceUrl: `https://opendata.porto.digital/api/3/action/datastore_search?resource_id=${resourceId}&limit=2&offset=0`,
        sourcePublishedAt: "2026-09-07T12:00:00.000Z",
      },
      products: [{ productKey: "records", suggestedSlug: "porto-sensors", completeness: "complete" }],
      checkpoint: { normalizer: { id: "ckan-resource", version: "6" }, state: { validators: { default: { etag: `"ckan:6:${resourceId}:2026-09-07T12:00:00.000Z"` } } } },
    });
    expect(frames.filter((frame) => isJsonObject(frame) && frame.type === "record")).toHaveLength(2);
    expect(frames.filter((frame) => isJsonObject(frame) && frame.type === "point")).toHaveLength(0);
    expect(frames.at(-1)).toMatchObject({
      type: "complete",
      counts: { records: 2, points: 0 },
      quality: { acceptedRecords: 2, rejectedRecords: 0 },
      products: [{ productKey: "records", watermark: "2026-09-07T11:00:00.000Z" }],
    });
  });
});
