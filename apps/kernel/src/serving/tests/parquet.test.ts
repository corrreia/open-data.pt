import type { CanonicalField, FieldType, JsonObject } from "@open-data-pt/contract";
import { parquetMetadata as readMetadata, parquetReadObjects } from "hyparquet";
import { describe, expect, it } from "vitest";
import type { ProductDetail } from "#/registry/registry";
import { buildChunks, compareKeys, type ManifestChunk } from "#/serving/chunks";
import { keys, ObjectStore, parquetKey } from "#/serving/object-store";
import { ParquetExports, ParquetTooLargeError, PARQUET_LIMITS, ROW_GROUP_LIMITS, type ParquetSource } from "#/serving/parquet";
import type { ChunkObject } from "#/serving/chunks";
import { MemorySnapshots } from "#/tests/kernel-harness";

const SOURCE: ParquetSource = {
  apiUrl: "https://open-data.pt/api/products/places",
  publisher: { id: "dgt", name: "Direção-Geral do Território", url: "https://www.dgterritorio.gov.pt" },
  sourceUrl: "https://ogcapi.dgterritorio.gov.pt/collections/places",
};

const TIME = { event: "2026-09-10T08:00:00.000Z", validFrom: null, validTo: null, sourcePublished: "2026-09-10T07:00:00Z", sequence: "7", observed: "2026-09-10T09:00:00.000Z" };

/** One record product served from real content-addressed chunks, the way the runner publishes it. */
async function published(fields: Array<{ name: string; type: FieldType }>, records: JsonObject[], options: { targetRows?: number } = {}) {
  const snapshots = new MemorySnapshots();
  const objects = new ObjectStore(snapshots);
  const rows = records.map((record) => ({ key: String(record.id), json: JSON.stringify({ ...record, _hash: "h", _time: TIME }) })).sort((a, b) => compareKeys(a.key, b.key));
  let chunks: ManifestChunk[];
  const sink = { prefix: keys.prefix("feed_1", "places"), known: new Set<string>(), put: async (key: string, body: string) => void (await objects.writeText(key, body)) };
  if (options.targetRows) {
    // Many small chunks, as a large product is served.
    chunks = [];
    for (let start = 0; start < rows.length; start += options.targetRows) chunks.push(...(await buildChunks(rows.slice(start, start + options.targetRows), sink)));
  } else chunks = await buildChunks(rows, sink);
  const schema = { fields: fields.map((field): CanonicalField => ({ id: field.name, nullable: true, ...field })) };
  const product: ProductDetail = {
    id: "prd_1",
    slug: "places",
    feedId: "feed_1",
    productKey: "places",
    title: "Places",
    description: "Every place",
    role: "reference",
    kind: "record",
    schema,
    updateMode: "authoritative-snapshot",
    completeness: "complete",
    version: 3,
    status: "current",
    currentAcquisitionId: "acq_1",
    watermark: null,
    rowCount: rows.length,
    chunks,
    changesKey: null,
    seriesKey: null,
    seriesChangesKey: null,
    updatedAt: "2026-09-10T09:00:00.000Z",
    createdAt: "2026-09-01T00:00:00.000Z",
    stale: false,
    exposeHistory: true,
    historyMode: "changes",
    licence: { id: "cc-by-4.0", name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
    attribution: "Direção-Geral do Território",
    staleAfterSeconds: 3600,
    cadenceSeconds: 3600,
  };
  const exports = new ParquetExports(snapshots, async (key) => (await objects.read<ChunkObject>(key))!.rows);
  return { snapshots, product, exports };
}

async function bytesOf(stream: ReadableStream<Uint8Array>): Promise<ArrayBuffer> {
  return new Response(stream).arrayBuffer();
}

async function download(fixture: Awaited<ReturnType<typeof published>>) {
  const result = await fixture.exports.download(fixture.product, async () => SOURCE);
  const file = await bytesOf(result.file.body);
  return { result, file, metadata: readMetadata(file), rows: await parquetReadObjects({ file }) };
}

const EVERY_TYPE: Array<{ name: string; type: FieldType }> = [
  { name: "name", type: "string" },
  { name: "kind", type: "category" },
  { name: "count", type: "number" },
  { name: "lat", type: "latitude" },
  { name: "lon", type: "longitude" },
  { name: "open", type: "boolean" },
  { name: "day", type: "date" },
  { name: "at", type: "datetime" },
  { name: "extra", type: "json" },
  { name: "site", type: "url" },
  { name: "colour", type: "color" },
  { name: "code", type: "identifier" },
  { name: "outline", type: "geometry" },
];

const PLACES: JsonObject[] = [
  {
    id: "a",
    name: "Alfama",
    kind: "quarter",
    count: 12,
    lat: 38.71,
    lon: -9.13,
    open: true,
    day: "2026-09-10",
    at: "2026-09-10T12:34:56Z",
    extra: { floors: [1, 2] },
    site: "https://example.pt/a",
    colour: "#ff0000",
    code: 17,
    outline: { type: "Point", coordinates: [-9.13, 38.71] },
  },
  {
    id: "b",
    name: "Belém",
    kind: "quarter",
    count: "7.5",
    lat: 38.69,
    lon: -9.2,
    open: "false",
    day: "2026-02-30",
    at: "not a time",
    extra: "plain",
    site: null,
    colour: "#00ff00",
    code: "B-2",
    outline: {
      type: "Polygon",
      coordinates: [
        [
          [-9.21, 38.69, 5],
          [-9.19, 38.69, 5],
          [-9.19, 38.7, 5],
          [-9.21, 38.69, 5],
        ],
      ],
    },
  },
  { id: "c", name: "Chiado", kind: "square", count: "n/a", open: "maybe", outline: { type: "Pointy", coordinates: [0, 0] } },
];

describe("a record product as one Parquet file", () => {
  it("maps every field type of the canonical schema to a Parquet column", async () => {
    const { metadata } = await download(await published(EVERY_TYPE, PLACES));
    const columns = Object.fromEntries(metadata.schema.slice(1).map((element) => [element.name, element]));
    expect(metadata.schema.slice(1).map((element) => element.name)).toEqual([
      "id",
      ...EVERY_TYPE.map((field) => field.name),
      "_event_time",
      "_valid_from",
      "_valid_to",
      "_source_published_at",
      "_source_sequence",
      "_observed_at",
    ]);
    expect(columns.id).toMatchObject({ type: "BYTE_ARRAY", converted_type: "UTF8", repetition_type: "REQUIRED" });
    for (const name of ["name", "kind", "site", "colour", "code", "_source_sequence"]) expect(columns[name]).toMatchObject({ type: "BYTE_ARRAY", converted_type: "UTF8" });
    for (const name of ["count", "lat", "lon"]) expect(columns[name]).toMatchObject({ type: "DOUBLE" });
    expect(columns.open).toMatchObject({ type: "BOOLEAN" });
    expect(columns.day).toMatchObject({ type: "INT32", converted_type: "DATE" });
    for (const name of ["at", "_event_time", "_observed_at"])
      expect(columns[name]).toMatchObject({ type: "INT64", logical_type: { type: "TIMESTAMP", isAdjustedToUTC: true, unit: "MILLIS" } });
    expect(columns.extra).toMatchObject({ type: "BYTE_ARRAY", converted_type: "JSON" });
    // GeoParquet: plain bytes holding WKB, marked as geometry by the `geo` metadata alone.
    expect(columns.outline).toMatchObject({ type: "BYTE_ARRAY", logical_type: { type: "GEOMETRY" } });
  });

  it("dictionary-encodes categories", async () => {
    const { metadata } = await download(await published(EVERY_TYPE, PLACES));
    const chunk = (name: string) => metadata.row_groups[0]!.columns.find((column) => column.meta_data?.path_in_schema[0] === name)!.meta_data!;
    expect(chunk("kind").encodings).toContain("RLE_DICTIONARY");
    expect(chunk("kind").dictionary_page_offset).toBeDefined();
  });

  it("reads back every value, and leaves null what is not of its field's type, counting it", async () => {
    const { rows, metadata } = await download(await published(EVERY_TYPE, PLACES));
    const [a, b, c] = rows;
    expect(a).toMatchObject({
      id: "a",
      name: "Alfama",
      kind: "quarter",
      count: 12,
      lat: 38.71,
      lon: -9.13,
      open: true,
      site: "https://example.pt/a",
      colour: "#ff0000",
      code: "17",
    });
    expect(a!.day).toEqual(new Date("2026-09-10T00:00:00Z"));
    expect(a!.at).toEqual(new Date("2026-09-10T12:34:56Z"));
    expect(a!.extra).toEqual({ floors: [1, 2] });
    expect(a!._event_time).toEqual(new Date(TIME.event));
    expect(a!._source_published_at).toEqual(new Date(TIME.sourcePublished));
    expect(a).toMatchObject({ _valid_from: null, _valid_to: null, _source_sequence: "7" });
    // A number written as text is still a number; a flag written as text is still a flag.
    expect(b).toMatchObject({ id: "b", count: 7.5, open: false, day: null, at: null, extra: "plain", site: null, code: "B-2" });
    expect(c).toMatchObject({ id: "c", count: null, open: null, lat: null, outline: null });
    const dropped = metadata.key_value_metadata?.find((entry) => entry.key === "dropped_values")?.value;
    expect(JSON.parse(dropped!)).toEqual({ count: 1, open: 1, day: 1, at: 1, outline: 1 });
  });

  it("writes geometry as WKB that a GeoParquet reader turns back into GeoJSON, with its types and extent", async () => {
    const { rows, metadata } = await download(await published(EVERY_TYPE, PLACES));
    expect(rows[0]!.outline).toEqual({ type: "Point", coordinates: [-9.13, 38.71] });
    expect(rows[1]!.outline).toEqual(PLACES[1]!.outline);
    const geo = JSON.parse(metadata.key_value_metadata!.find((entry) => entry.key === "geo")!.value!);
    expect(geo).toEqual({
      version: "1.1.0",
      primary_column: "outline",
      columns: { outline: { encoding: "WKB", geometry_types: ["Point", "Polygon Z"], bbox: [-9.21, 38.69, -9.13, 38.71] } },
    });
  });

  it("carries the licence, attribution, source and version in its key-value metadata", async () => {
    const { metadata } = await download(await published([{ name: "name", type: "string" }], PLACES));
    const entries = Object.fromEntries((metadata.key_value_metadata ?? []).map((entry) => [entry.key, entry.value]));
    expect(entries).toMatchObject({
      product: "places",
      title: "Places",
      version: "3",
      updated_at: "2026-09-10T09:00:00.000Z",
      licence: "CC BY 4.0",
      licence_id: "cc-by-4.0",
      licence_url: "https://creativecommons.org/licenses/by/4.0/",
      attribution: "Direção-Geral do Território",
      publisher: "Direção-Geral do Território",
      publisher_url: "https://www.dgterritorio.gov.pt",
      source: SOURCE.sourceUrl,
      api: SOURCE.apiUrl,
    });
    // Without a geometry there is no GeoParquet metadata, and with nothing dropped no count.
    expect(entries.geo).toBeUndefined();
    expect(entries.dropped_values).toBeUndefined();
  });

  it("writes a product with no rows as a valid empty file", async () => {
    const { rows, metadata } = await download(await published([{ name: "name", type: "string" }], []));
    expect(rows).toEqual([]);
    expect(metadata.num_rows).toBe(0n);
  });
});

describe("a Parquet file is written once per product version", () => {
  it("writes on the first request and reads R2 on the next, without reading a chunk again", async () => {
    const fixture = await published(EVERY_TYPE, PLACES);
    const first = await fixture.exports.download(fixture.product, async () => SOURCE);
    expect(first.written?.rows).toBe(3);
    const bytes = await bytesOf(first.file.body);
    const readsAfterWrite = fixture.snapshots.reads;
    let described = 0;
    const second = await fixture.exports.download(fixture.product, async () => {
      described += 1;
      return SOURCE;
    });
    expect(second.written).toBeUndefined();
    expect(described).toBe(0);
    expect(fixture.snapshots.uploads).toEqual([parquetKey(fixture.product)]);
    // One read: the file itself. No chunk was read again.
    expect(fixture.snapshots.reads - readsAfterWrite).toBe(1);
    expect(await bytesOf(second.file.body)).toEqual(bytes);
    expect(second.etag).toBe(first.etag);
  });

  it("writes again for a new version, and for new terms on the same version", async () => {
    const fixture = await published([{ name: "name", type: "string" }], PLACES);
    const first = await fixture.exports.download(fixture.product, async () => SOURCE);
    const newer = { ...fixture.product, version: 4 };
    expect(parquetKey(newer)).not.toBe(parquetKey(fixture.product));
    expect((await fixture.exports.download(newer, async () => SOURCE)).written).toBeDefined();
    const relicensed = { ...fixture.product, attribution: "DGT" };
    const rewritten = await fixture.exports.download(relicensed, async () => SOURCE);
    expect(rewritten.written).toBeDefined();
    expect(rewritten.etag).not.toBe(first.etag);
    const file = await bytesOf(rewritten.file.body);
    expect(readMetadata(file).key_value_metadata?.find((entry) => entry.key === "attribution")?.value).toBe("DGT");
    expect(fixture.snapshots.uploads).toEqual([parquetKey(fixture.product), parquetKey(newer), parquetKey(fixture.product)]);
  });

  it("serves a byte range of the stored file", async () => {
    const fixture = await published([{ name: "name", type: "string" }], PLACES);
    const whole = await bytesOf((await fixture.exports.download(fixture.product, async () => SOURCE)).file.body);
    const tail = await fixture.exports.download(
      fixture.product,
      async () => SOURCE,
      (size) => ({ offset: size - 8, length: 8 }),
    );
    expect(tail.file.range).toEqual({ offset: whole.byteLength - 8, length: 8 });
    expect(new Uint8Array(await bytesOf(tail.file.body))).toEqual(new Uint8Array(whole.slice(-8)));
  });

  it("has nothing for a time series", async () => {
    const fixture = await published([{ name: "name", type: "string" }], PLACES);
    const series = { ...fixture.product, kind: "series" as const, role: "time-series" as const, chunks: null };
    await expect(fixture.exports.download(series, async () => SOURCE)).rejects.toThrow(/time series has no Parquet/);
  });
});

describe("a large product", () => {
  it("is written a row group at a time, never holding more than one", async () => {
    const count = ROW_GROUP_LIMITS.chunks * 3 * 10 + 5;
    const records = Array.from({ length: count }, (_, index): JsonObject => ({ id: `r${String(index).padStart(5, "0")}`, n: index, kind: `k${index % 3}` }));
    const fixture = await published(
      [
        { name: "n", type: "number" },
        { name: "kind", type: "category" },
      ],
      records,
      { targetRows: 10 },
    );
    const { result, metadata, rows } = await download(fixture);
    expect(fixture.product.chunks!.length).toBeGreaterThan(ROW_GROUP_LIMITS.chunks * 3);
    expect(result.written).toMatchObject({ rows: count, rowGroups: Math.ceil(fixture.product.chunks!.length / ROW_GROUP_LIMITS.chunks) });
    expect(metadata.row_groups).toHaveLength(result.written!.rowGroups);
    expect(rows.map((row) => row.n)).toEqual(records.map((record) => record.n));
  });

  it("is refused before any chunk is read when one request could not write it", async () => {
    const fixture = await published([{ name: "n", type: "number" }], [{ id: "a", n: 1 }]);
    const chunk = fixture.product.chunks![0]!;
    const huge = { ...fixture.product, chunks: [{ ...chunk, rows: PARQUET_LIMITS.rows + 1 }] };
    const reads = fixture.snapshots.reads;
    await expect(fixture.exports.download(huge, async () => SOURCE)).rejects.toBeInstanceOf(ParquetTooLargeError);
    await expect(fixture.exports.download(huge, async () => SOURCE)).rejects.toThrow(/records\/all/);
    const many = { ...fixture.product, chunks: Array.from({ length: PARQUET_LIMITS.chunks + 1 }, () => ({ ...chunk, rows: 1 })) };
    await expect(fixture.exports.download(many, async () => SOURCE)).rejects.toBeInstanceOf(ParquetTooLargeError);
    expect(fixture.snapshots.reads).toBe(reads);
    expect(fixture.snapshots.uploads).toEqual([]);
  });
});
