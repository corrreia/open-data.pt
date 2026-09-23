import { describe, expect, it } from "vitest";
import { readFixture } from "#/tests/support";
import { datasetOf, feedsOf } from "#/tests/catalog";
import { isJsonObject, libraryConfig, parseJson, toByteStream, type JsonObject, type JsonValue, type NormalizedRow, type SourceConfig, type SourceFetch } from "#/index";
import { OpendatasoftSource, validateOpendatasoftFeedConfig } from "#/formats/opendatasoft/opendatasoft";
import { resolveOpendatasoftFeed } from "#/formats/opendatasoft/collector";
import { OpendatasoftTransformer } from "#/formats/opendatasoft/transform";

const OPENDATASOFT_EXAMPLES = feedsOf("opendatasoft");
/** The feeds that read a bounded window of reporting periods: the catalog expansion. */
const CATALOG_EXAMPLES = OPENDATASOFT_EXAMPLES.filter((example) => example.policy.name.endsWith("bounded reporting-period collection"));

const HOSTS = new Set(["e-redes.opendatasoft.com", "transparencia.sns.gov.pt"]);
const BASE = { host: "e-redes.opendatasoft.com", dataset: "sample", limit: "100" };

function fixture(name: string): JsonObject {
  const value = parseJson(readFixture(new URL(`./fixtures/${name}.json`, import.meta.url)));
  if (!isJsonObject(value)) throw new Error("Invalid fixture");
  return value;
}

function capture(records: JsonObject[], fields: JsonObject[]): JsonObject {
  return {
    dataset: { dataset_id: "sample", fields, metas: { default: { title: "Sample", description: "Source description", records_count: 1000, modified: "2026-09-01T00:00:00Z" } } },
    records,
  };
}

async function transform(config: SourceConfig, document: JsonObject, observedAt = "2026-09-16T00:00:00Z", chunkSize = 97) {
  const bytes = new TextEncoder().encode(JSON.stringify(document));
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + chunkSize));
      offset += chunkSize;
    },
  });
  const result = await new OpendatasoftTransformer().transform(body, {
    feed: {
      slug: "sample-feed",
      title: "Sample",
      description: "Only the declared source scope",
      config,
      semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
    },
    observedAt,
  });
  const rows: NormalizedRow[] = [];
  for await (const row of result.rows) rows.push(row);
  return { products: result.products, rows, summary: result.finish() };
}

function field(name: string, type = "text"): JsonObject {
  return { name, type, annotations: {} };
}

async function body(fetched: SourceFetch): Promise<JsonValue> {
  if (fetched.kind !== "body") throw new Error("Expected body");
  return parseJson(await new Response(toByteStream(fetched.body)).text());
}

describe("Opendatasoft catalog expansion", () => {
  it("adds all eleven E-REDES and seventeen SNS candidates without duplicate feeds", () => {
    expect(CATALOG_EXAMPLES).toHaveLength(28);
    expect(CATALOG_EXAMPLES.filter((example) => datasetOf(example).publisher === "e-redes")).toHaveLength(11);
    expect(OPENDATASOFT_EXAMPLES).toHaveLength(57);
    expect(new Set(OPENDATASOFT_EXAMPLES.map((example) => example.slug)).size).toBe(57);
    expect(new Set(OPENDATASOFT_EXAMPLES.map((example) => `${example.config.host}/${example.config.dataset}`)).size).toBe(57);
    for (const example of CATALOG_EXAMPLES) {
      expect(() => validateOpendatasoftFeedConfig(libraryConfig(example.config), HOSTS)).not.toThrow();
      expect(example.policy.collection.cadenceSeconds).toBeGreaterThanOrEqual(86_400);
      // Every grouped series keeps the full set of non-time grouping dimensions, including numeric-looking codes.
      if (example.config.groupBy && example.config.series) {
        const clock = new Set([example.config.timeField, example.config.monthField]);
        expect(example.config.dimensions?.split(",")).toEqual(example.config.groupBy.split(",").filter((name) => !clock.has(name)));
      }
    }
  });

  for (const example of CATALOG_EXAMPLES) {
    it(`normalizes the verified source schema for ${example.slug}`, async () => {
      const result = await transform(libraryConfig(example.config), fixture(example.config.dataset!));
      expect(result.summary.quality.rejectedRecords).toBe(0);
      expect(result.rows.length).toBeGreaterThan(0);
      const products = result.products;
      expect(new Set(products.map((product) => product.kind)).size).toBe(1);
      if (example.config.series) {
        expect(products.map((product) => product.productKey)).toEqual(example.config.series.split(",").map((name) => `series:${name}`));
        for (const row of result.rows) {
          expect(row.record).toBeUndefined();
          expect(row.point?.unit).not.toBe("value");
          expect(row.point?.eventTime).not.toBe("2026-09-16T00:00:00Z");
        }
      } else expect(products.map((product) => product.kind)).toEqual(["record"]);
    });
  }

  it("preserves numeric and high-cardinality dimensions instead of collapsing postal areas", async () => {
    const rows = Array.from({ length: 5001 }, (_, index) => ({ date: "2026-05", postcode: String(1000 + index), chapter: index % 2, energy: index }));
    const config = { ...BASE, series: "energy", dimensions: "postcode,chapter", timeField: "date", units: "energy=kWh" };
    const result = await transform(config, capture(rows, [field("date", "date"), field("postcode"), field("chapter", "int"), field("energy", "double")]));
    expect(result.rows).toHaveLength(5001);
    expect(new Set(result.rows.map((row) => row.point?.seriesKey)).size).toBe(5001);
    expect(result.rows[0]?.point?.dimensions).toEqual({ postcode: "1000", chapter: "0" });
  });

  it("uses source year/month and Portuguese quarter parts, independently of poll time and chunk size", async () => {
    const document = capture(
      [{ year: "2026", month: "9", quarter: "Terceiro", code: "01", value: 5 }],
      [field("year"), field("month"), field("quarter"), field("code"), field("value", "int")],
    );
    const config = { ...BASE, timeField: "year", monthField: "month", dimensions: "code", series: "value", units: "value=count" };
    const first = await transform(config, document, "2030-01-01T00:00:00Z", 1);
    const second = await transform(config, document, "2040-01-01T00:00:00Z", 23);
    expect(first).toEqual(second);
    expect(first.rows[0]?.point?.eventTime).toBe("2026-09-01T00:00:00.000Z");
    const quarterly = await transform({ ...BASE, timeField: "year", quarterField: "quarter", dimensions: "code", series: "value" }, document);
    expect(quarterly.rows[0]?.point?.eventTime).toBe("2026-07-01T00:00:00.000Z");
    expect((await resolveOpendatasoftFeed(config, HOSTS)).history).toBeUndefined();
  });

  it("rejects conflicting unlabelled series revisions instead of silently choosing the first", async () => {
    const document = capture(
      [
        { date: "2026-05", code: "1", energy: 5 },
        { date: "2026-05", code: "1", energy: 6 },
      ],
      [field("date", "date"), field("code"), field("energy", "double")],
    );
    await expect(transform({ ...BASE, timeField: "date", dimensions: "code", series: "energy" }, document)).rejects.toThrow("revision order is unknown");
    const example = CATALOG_EXAMPLES.find((item) => item.slug === "sns-lvt-hospital-morbidity-mortality-feed")!;
    expect(example.config.series).toBeUndefined();
    expect(example.description ?? datasetOf(example).description).toContain("conflicting unlabelled revisions");
    expect(example.config.groupBy).toBe(example.config.idFields);
  });

  it("uses complete configured record keys for corrections and rejects missing keys or clocks", async () => {
    const fields = [field("date", "date"), field("district"), field("id"), field("value", "int")];
    const config = { ...BASE, idFields: "district,id", timeField: "date", period: "day", windowPeriods: "2" };
    const first = await transform(config, capture([{ date: "2026-09-01", district: "1", id: "20", value: 10 }], fields));
    const second = await transform(config, capture([{ date: "2026-09-01", district: "1", id: "20", value: 11 }], fields));
    expect(first.rows[0]?.record?.entityKey).toBe(second.rows[0]?.record?.entityKey);
    expect(first.products[0]?.updateMode).toBe("source-window");
    const missing = await transform(
      config,
      capture(
        [
          { date: "2026-09-01", district: "1", id: null, value: 10 },
          { date: null, district: "1", id: "20", value: 11 },
        ],
        fields,
      ),
    );
    expect(missing.rows).toHaveLength(0);
    expect(missing.summary.quality.rejectedRecords).toBe(2);
  });

  it("rejects malformed explicit field, dimension and reporting-window options", () => {
    for (const options of [
      { timeField: "date;drop" },
      { idFields: "id,id" },
      { dimensions: "id;drop" },
      { units: "x=kWh\nignored" },
      { windowPeriods: "0", period: "month", timeField: "date" },
      { windowPeriods: "367", period: "month", timeField: "date" },
      { windowPeriods: "2", period: "month" },
      { monthField: "month" },
      { timeField: "year", monthField: "month", quarterField: "quarter" },
    ])
      expect(() => validateOpendatasoftFeedConfig({ ...BASE, ...options }, HOSTS)).toThrow();
    expect(validateOpendatasoftFeedConfig({ ...BASE, dimensions: "", where: "region = 'Região de Saúde LVT'" }, HOSTS).dimensions).toBe("");
  });
});

describe("source-side Opendatasoft bounds", () => {
  it("anchors a full grouped export to the newest source month and preserves select/group_by", async () => {
    const document = capture([], [field("date", "date"), field("code"), field("energy", "double")]);
    const seen: URL[] = [];
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      seen.push(url);
      if (seen.length === 1) return Response.json(document.dataset);
      if (seen.length === 2) return Response.json({ total_count: 1000, results: [{ date: "2023-12" }] });
      if (seen.length === 3) return Response.json({ total_count: 1, results: [{ date: "2023-12", code: "1000", energy: 2 }] });
      return Response.json([
        { date: "2023-12", code: "1000", energy: 2 },
        { date: "2023-11", code: "4000", energy: 3 },
      ]);
    };
    const config = { ...BASE, timeField: "date", period: "month", windowPeriods: "2", select: "date,code,sum(energy) as energy", groupBy: "date,code", orderBy: "date DESC,code" };
    const fetched = await new OpendatasoftSource(HOSTS, fetcher).collect(config);
    expect(fetched.kind === "body" && fetched.completeness).toBe("complete");
    const value = await body(fetched);
    expect(isJsonObject(value) && value.records).toHaveLength(2);
    expect(seen[3]?.searchParams.get("where")).toBe("date >= '2023-11'");
    expect(seen[3]?.searchParams.get("group_by")).toBe("date,code");
    expect(seen[3]?.searchParams.get("select")).toBe(config.select);
  });

  it("bounds grouped exports even when total_count only reports the first-page group count", async () => {
    const document = capture([], [field("code"), field("energy", "double")]);
    let request = 0;
    const fetcher: typeof fetch = async () => {
      request += 1;
      if (request === 1) return Response.json(document.dataset);
      if (request === 2) return Response.json({ total_count: 1, results: [{ code: "a", energy: 1 }] });
      return Response.json([
        { code: "a", energy: 1 },
        { code: "b", energy: 2 },
        { code: "c", energy: 3 },
      ]);
    };
    const fetched = await new OpendatasoftSource(HOSTS, fetcher).collect({ ...BASE, groupBy: "code", select: "code,sum(energy) as energy", limit: "2" });
    await expect(body(fetched)).rejects.toThrow("grouped scope exceeds 2 rows");
  });

  it("fails a reporting window that is too large rather than publishing an arbitrary prefix", async () => {
    const document = capture([], [field("date", "date")]);
    let request = 0;
    const fetcher: typeof fetch = async () => {
      request += 1;
      if (request === 1) return Response.json(document.dataset);
      return Response.json({ total_count: 1000, results: [{ date: "2026-09" }] });
    };
    await expect(new OpendatasoftSource(HOSTS, fetcher).collect({ ...BASE, timeField: "date", period: "month", windowPeriods: "2" })).rejects.toThrow(
      "reporting window exceeds 100 rows",
    );
  });

  for (const type of ["text", "date"]) {
    it(`filters source years using their ${type} semantics`, async () => {
      const document = capture([], [field("year", type)]);
      const seen: URL[] = [];
      const fetcher: typeof fetch = async (input) => {
        seen.push(new URL(String(input)));
        if (seen.length === 1) return Response.json(document.dataset);
        if (seen.length === 2) return Response.json({ total_count: 1000, results: [{ year: "2026" }] });
        if (seen.length === 3) return Response.json({ total_count: 1, results: [{ year: "2026" }] });
        return Response.json([{ year: "2026" }]);
      };
      await body(await new OpendatasoftSource(HOSTS, fetcher).collect({ ...BASE, timeField: "year", period: "year", windowPeriods: "2" }));
      expect(seen[2]?.searchParams.get("where")).toBe(type === "text" ? "year IN ('2025','2026')" : "year >= '2025'");
    });
  }

  it("walks text-year history using supported equality filters and an exclusive cursor", async () => {
    const document = capture([], [field("year")]);
    const seen: URL[] = [];
    const fetcher: typeof fetch = async (input) => {
      seen.push(new URL(String(input)));
      if (seen.length === 1) return Response.json(document.dataset);
      if (seen.length === 2) return Response.json({ total_count: 1000, results: [{ year: "2024" }] });
      return Response.json([{ year: "2025" }]);
    };
    const config = { ...BASE, timeField: "year", period: "year", windowPeriods: "2" };
    await body(await new OpendatasoftSource(HOSTS, fetcher).collectHistory(config, { before: "2026-01-01T00:00:00.000Z" }));
    expect(seen[2]?.searchParams.get("where")).toBe("year IN ('2024','2025')");
  });

  it("keeps aggregation and selection on source-supported historical exports", async () => {
    const document = capture([], [field("date", "date"), field("code"), field("energy", "double")]);
    const seen: URL[] = [];
    const fetcher: typeof fetch = async (input) => {
      seen.push(new URL(String(input)));
      if (seen.length === 1) return Response.json(document.dataset);
      if (seen.length === 2) return Response.json({ total_count: 1000, results: [{ date: "2020-01" }] });
      return Response.json([{ date: "2025-12", code: "1000", energy: 2 }]);
    };
    const config = { ...BASE, timeField: "date", period: "month", windowPeriods: "2", select: "date,code,sum(energy) as energy", groupBy: "date,code", orderBy: "date DESC,code" };
    await body(await new OpendatasoftSource(HOSTS, fetcher).collectHistory(config, { before: "2026-01-01T00:00:00.000Z" }));
    expect(seen[2]?.searchParams.get("group_by")).toBe("date,code");
    expect(seen[2]?.searchParams.get("select")).toBe(config.select);
    expect(seen[2]?.searchParams.get("order_by")).toBe(config.orderBy);
  });
});
