import { describe, expect, it } from "vitest";
import { readFixture } from "#/tests/support";
import {
  isJsonObject,
  isJsonArray,
  isJsonNumber,
  isJsonString,
  libraryConfig,
  parseJson,
  type CanonicalRecord,
  type ExampleFeed,
  type JsonObject,
  type JsonValue,
  type SeriesPoint,
  type SourceConfig,
  type StreamingSummary,
  type TransformContext,
} from "#/index";
import { CkanSource, validateCkanFeedConfig } from "#/formats/ckan/index";
import { transformCkan, type CkanResourceMetadata } from "#/formats/ckan/index";
import { datasetOf, feedCollection, feedsOf } from "#/tests/catalog";

const HOSTS = new Set(["dadosabertos.cm-agueda.pt", "oeirasinterativa.oeiras.pt"]);
const OEIRAS = example("oeiras-hourly-environment-feed");
const MONTHLY_CONFIG = libraryConfig(OEIRAS.config);
const CSV = readFixture(new URL("./fixtures/oeiras-hourly.csv", import.meta.url));
const MONTHLY = object(fixture("oeiras-monthly-package.json"));
const AGUEDA = array(fixture("agueda-locations.json")).map(object);

function fixture(name: string): JsonValue {
  return parseJson(readFixture(new URL(`./fixtures/${name}`, import.meta.url)));
}
function object(value: JsonValue | undefined): JsonObject {
  if (!isJsonObject(value)) throw new Error("Expected object");
  return value;
}
function array(value: JsonValue | undefined): JsonValue[] {
  if (!isJsonArray(value)) throw new Error("Expected array");
  return value;
}
function text(value: JsonValue | undefined): string {
  if (!isJsonString(value)) throw new Error("Expected string");
  return value;
}
function example(slug: string): ExampleFeed {
  const found = feedsOf("ckan").find((entry) => entry.slug === slug);
  if (!found) throw new Error(slug);
  return found;
}
function bytesInChunks(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
        return;
      }
      const chunk = bytes.slice(offset, offset + size);
      offset += chunk.length;
      controller.enqueue(chunk);
    },
  });
}
function body(value: string, size = 1): ReadableStream<Uint8Array> {
  return bytesInChunks(new TextEncoder().encode(value), size);
}
function context(entry: ExampleFeed, observedAt = "2026-09-15T00:00:00Z"): TransformContext {
  return {
    observedAt,
    feed: {
      slug: entry.slug,
      title: entry.title ?? datasetOf(entry).title,
      description: entry.description ?? datasetOf(entry).description,
      config: libraryConfig(entry.config),
      semantics: { domainSubject: "reference", defaultProductRole: "reference" },
    },
  };
}
interface Result {
  records: CanonicalRecord[];
  points: SeriesPoint[];
  summary: StreamingSummary;
}
async function normalize(value: string, entry: ExampleFeed, format: "geojson" | "csv", chunkSize = 1, observedAt?: string): Promise<Result> {
  const metadata: CkanResourceMetadata = { package: {}, resource: { id: entry.config.resource ?? "rotating" }, source: { kind: "file", format } };
  const transformed = await transformCkan(body(value, chunkSize), context(entry, observedAt), metadata);
  const records: CanonicalRecord[] = [];
  const points: SeriesPoint[] = [];
  for await (const row of transformed.rows) {
    if (row.record) records.push(row.record);
    else points.push(row.point);
  }
  return { records, points, summary: transformed.finish() };
}

describe("Águeda municipal reference inventories", () => {
  it.each(AGUEDA)("streams and projects $slug without inventing observation clocks", async (saved) => {
    const entry = example(text(saved.slug));
    const geojson = object(saved.geojson);
    const source = JSON.stringify(geojson);
    const first = await normalize(source, entry, "geojson");
    const later = await normalize(source, entry, "geojson", 13, "2027-01-01T00:00:00Z");
    expect(first).toEqual(later);
    expect(first.summary.quality).toEqual({ acceptedRecords: array(geojson.features).length, rejectedRecords: 0 });
    expect(first.points).toEqual([]);
    for (const [index, record] of first.records.entries()) {
      const original = object(array(geojson.features)[index]);
      const properties = object(original.properties);
      expect(record.entityKey).toBe(String(properties[entry.config.idField ?? "id"]));
      const latitude = record.payload.centroidLatitude;
      const longitude = record.payload.centroidLongitude;
      if (!isJsonNumber(latitude) || !isJsonNumber(longitude)) throw new Error("Missing coordinates");
      expect(latitude).toBeGreaterThan(40);
      expect(latitude).toBeLessThan(41);
      expect(longitude).toBeGreaterThan(-9);
      expect(longitude).toBeLessThan(-8);
    }
    expect(entry.policy.collection.cadenceSeconds).toBe(30 * 86_400);
  });

  it("keeps provider identity through changes and rejects a missing configured ID", async () => {
    const saved = AGUEDA.find((saved) => saved.slug === "agueda-flood-marks-feed");
    if (!saved) throw new Error("Missing flood fixture");
    const entry = example(text(saved.slug));
    const original = object(saved.geojson);
    const changed = object(parseJson(JSON.stringify(original)));
    object(object(array(changed.features)[0]).properties).elevation = 11;
    const first = await normalize(JSON.stringify(original), entry, "geojson");
    const second = await normalize(JSON.stringify(changed), entry, "geojson");
    expect(first.records[0]?.entityKey).toBe(second.records[0]?.entityKey);
    expect(first.records[0]?.payload).not.toEqual(second.records[0]?.payload);
    delete object(object(array(changed.features)[0]).properties).gid;
    await expect(normalize(JSON.stringify(changed), entry, "geojson")).rejects.toThrow("configured identity");
  });

  it("retains GeoJSON feature IDs and fails a mismatching or truncated collection", async () => {
    const entry = example("agueda-beagueda-stations-feed");
    const feature = { type: "Feature", id: "001", properties: { name: "A" }, geometry: { type: "Point", coordinates: [-8.4, 40.5, 7] } };
    const source = JSON.stringify({ type: "FeatureCollection", features: [feature] });
    const normalized = await normalize(source, entry, "geojson");
    expect(normalized.records[0]?.entityKey).toBe("001");
    expect(normalized.records[0]?.payload.geometry).toEqual(feature.geometry);
    await expect(normalize(source.slice(0, -2), entry, "geojson")).rejects.toThrow();
    await expect(normalize(JSON.stringify({ crs: { name: "EPSG:3857" }, type: "FeatureCollection", features: [feature] }), entry, "geojson")).rejects.toThrow("CRS");
  });
});

describe("CKAN monthly discovery and explicit CSV observations", () => {
  it("validates canonical options, rejects path injection, and preserves reference identities", async () => {
    const source = new CkanSource(HOSTS, fetch);
    expect(source.validateConfig({ ...MONTHLY_CONFIG, apiPath: "/dadosabertos/" }).apiPath).toBe("/dadosabertos");
    for (const apiPath of ["//attacker.example", "/../internal", "/%2e%2e", "/dados?redirect=x"]) expect(() => source.validateConfig({ ...MONTHLY_CONFIG, apiPath })).toThrow();
    for (const extra of [
      { resource: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
      { resourcePrefix: "(.*)" },
      { resourceSelection: "latest" },
      { decimal: ":" },
      { measures: "[]" },
      { measures: '{"Date":"s"}' },
    ])
      expect(() => source.validateConfig({ ...MONTHLY_CONFIG, ...extra })).toThrow();
    const reference = { host: "dadosabertos.cm-agueda.pt", dataset: "cotas-de-cheia" };
    expect(validateCkanFeedConfig(reference, HOSTS)).toEqual(reference);
    const { resolved } = await feedCollection(OEIRAS.slug);
    expect(resolved.kind).toBe("ckan:observations");
    expect(resolved.semantics.domainSubject).toBe("observation");
  });

  it("selects the latest named month, not the first resource or an old file edited today, and no-ops", async () => {
    const document = object(parseJson(JSON.stringify(MONTHLY)));
    const resources = array(object(document.result).resources).map(object);
    if (!resources[0]) throw new Error("Missing old month");
    resources[0].last_modified = "2030-01-01T00:00:00Z";
    const urls: string[] = [];
    const source = new CkanSource(HOSTS, async (input, init) => {
      const url = input.toString();
      urls.push(url);
      if (url.includes("package_show")) return Response.json(document);
      expect(url).toMatch(/qart_dados_medias_1h_08_26\.csv$/);
      expect(new Headers(init?.headers).has("if-modified-since")).toBe(false);
      return new Response(CSV);
    });
    const first = await source.collect(MONTHLY_CONFIG);
    expect(urls[0]).toContain("/dadosabertos/api/3/action/package_show?");
    expect(first.metadata?.resource.id).toBe("586742df-e8f2-464a-8202-1c7900597c6f");
    if (first.fetch.kind !== "body") throw new Error("Expected selected CSV");
    await new Response(first.fetch.body).text();
    expect(first.fetch.provenance.sourcePublishedAt).toBe("2026-09-01T09:22:37.737Z");
    object(document.result).resources = resources.reverse();
    const next = await source.collect(MONTHLY_CONFIG, first.fetch.validator);
    expect(next.fetch.kind).toBe("not-modified");
    expect(urls).toHaveLength(3);
  });

  it("does not carry old validators across resource rotation with identical modification dates", async () => {
    const document = object(parseJson(JSON.stringify(MONTHLY)));
    const resources = array(object(document.result).resources).map(object);
    const latest = resources.at(-1);
    if (!latest) throw new Error("Missing latest month");
    let downloadHeaders: Headers | undefined;
    const source = new CkanSource(HOSTS, async (input, init) => {
      if (input.toString().includes("package_show")) return Response.json(document);
      downloadHeaders = new Headers(init?.headers);
      return new Response(CSV);
    });
    const first = await source.collect(MONTHLY_CONFIG);
    if (first.fetch.kind !== "body") throw new Error("Expected source body");
    await new Response(first.fetch.body).text();
    latest.id = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    latest.url = text(latest.url).replace("08_26.csv", "09_26.csv");
    const rotated = await source.collect(MONTHLY_CONFIG, first.fetch.validator);
    expect(rotated.fetch.kind).toBe("body");
    expect(downloadHeaders?.has("if-none-match")).toBe(false);
    expect(downloadHeaders?.has("if-modified-since")).toBe(false);
    if (rotated.fetch.kind === "body") await new Response(rotated.fetch.body).text();
  });

  it("fails missing monthly distributions and unsolicited 304s, dropping absent validators", async () => {
    const unavailable = object(parseJson(JSON.stringify(MONTHLY)));
    object(unavailable.result).resources = [];
    const missing = new CkanSource(HOSTS, async () => Response.json(unavailable));
    await expect(missing.collect(MONTHLY_CONFIG)).rejects.toThrow("no monthly CSV");
    const unsolicited = new CkanSource(HOSTS, async (input) => (input.toString().includes("package_show") ? Response.json(MONTHLY) : new Response(null, { status: 304 })));
    await expect(unsolicited.collect(MONTHLY_CONFIG)).rejects.toThrow("unsolicited 304");
    const noDates = object(parseJson(JSON.stringify(MONTHLY)));
    delete object(noDates.result).metadata_modified;
    for (const resource of array(object(noDates.result).resources).map(object)) delete resource.last_modified;
    const uncached = new CkanSource(HOSTS, async (input) => (input.toString().includes("package_show") ? Response.json(noDates) : new Response(CSV)));
    const result = await uncached.collect(MONTHLY_CONFIG, { etag: '"old"' });
    expect(result.fetch).toMatchObject({ kind: "body", state: {} });
    if (result.fetch.kind === "body") await new Response(result.fetch.body).text();
  });

  it("reads real semicolon/comma-decimal hourly rows byte by byte with source times and units only once", async () => {
    const transformed = await transformCkan(body(CSV), context(OEIRAS), { package: {}, resource: {}, source: { kind: "file", format: "csv" } });
    expect(transformed.products).toMatchObject([{ productKey: "observations", role: "time-series", kind: "series", updateMode: "source-window" }]);
    for await (const row of transformed.rows) expect(row.point).toBeDefined();
    expect(OEIRAS.policy.collection.cadenceSeconds).toBe(604_800);
    const first = await normalize(CSV, OEIRAS, "csv");
    const later = await normalize(CSV, OEIRAS, "csv", 11, "2027-01-01T00:00:00Z");
    expect(first).toEqual(later);
    expect(first.records).toEqual([]);
    expect(first.points).toHaveLength(3 * 17);
    expect(first.points.find((point) => point.seriesKey === "CO - µg/m3")).toEqual({
      seriesKey: "CO - µg/m3",
      eventTime: "2026-07-31T23:00:00.000Z",
      value: 259.05,
      unit: "µg/m³",
      dimensions: { measure: "CO - µg/m3" },
    });
    expect(first.points.find((point) => point.seriesKey === "LAeq,T - dB(A)")?.unit).toBe("dB(A)");
    expect(first.summary.quality.rejectedRecords).toBe(0);
    expect(first.summary.products?.[0]?.watermark).toBe("2026-08-01T01:00:00.000Z");
  });

  it("rejects malformed observations without turning missing measurements into zero or claiming a complete window", async () => {
    const config: SourceConfig = { ...MONTHLY_CONFIG, measures: JSON.stringify({ value: "°C" }) };
    const entry = { ...OEIRAS, config };
    const result = await normalize(
      "Date;value\n2026-09-01T00:00:00Z;0\n2026-09-01T01:00:00Z;\n2026-09-01T02:00:00Z;NaN\n2026-09-01T03:00:00;1,2\n2026-09-01T04:00:00Z;1;extra\n",
      entry,
      "csv",
    );
    expect(result.points.map((point) => point.value)).toEqual([0]);
    expect(result.summary.quality).toEqual({ acceptedRecords: 1, rejectedRecords: 4 });
    expect(result.summary.products?.[0]?.completeness).toBe("partial");
    await expect(normalize("Date;wrong\n2026-09-01T00:00:00Z;3\n", entry, "csv")).rejects.toThrow("omitted");
    await expect(normalize('Date;value\n2026-09-01T00:00:00Z;"unfinished', entry, "csv")).rejects.toThrow();
  });
});
