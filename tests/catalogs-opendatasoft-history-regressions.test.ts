import { datasetOf, feedsOf } from "./catalog";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NORMALIZED_PROTOCOL,
  collectNormalized,
  isJsonObject,
  isNormalizedFrame,
  libraryConfig,
  parseJson,
  toByteStream,
  type CollectionRequest,
  type JsonObject,
  type NormalizedRow,
  type SourceConfig,
} from "../apps/gatekeeper/src/index";
import { opendatasoftCollector } from "../apps/gatekeeper/src/formats/opendatasoft/collector";
import { MAX_HISTORY_NORMALIZED_ROWS, OpendatasoftSource } from "../apps/gatekeeper/src/formats/opendatasoft/opendatasoft";
import { OpendatasoftTransformer } from "../apps/gatekeeper/src/formats/opendatasoft/transform";

function fixture(name: string): JsonObject {
  const value = parseJson(readFileSync(new URL(`./fixtures/catalogs-expansion/${name}.json`, import.meta.url), "utf8"));
  if (!isJsonObject(value)) throw new Error("Invalid fixture");
  return value;
}

function annualRecords(measures: string[]): JsonObject[] {
  return Array.from({ length: 9 * 278 }, (_, index): JsonObject => {
    const row: JsonObject = { year: String(2014 + Math.floor(index / 278)), municipality: String(index % 278) };
    for (const [measureIndex, name] of measures.entries()) row[name] = index + measureIndex;
    return row;
  });
}

describe("Opendatasoft measure-expanded history bounds", () => {
  for (const measureCount of [10, 16]) {
    it(`walks complete annual cohorts with ${measureCount} measures without exceeding the normalized policy or losing a year`, async () => {
      const measures = Array.from({ length: measureCount }, (_, index) => `m${index}`);
      const records = annualRecords(measures);
      const metadata: JsonObject = {
        dataset_id: "annual-budget",
        metas: { default: { title: "Annual indicators", description: "Synthetic history boundary regression", records_count: records.length } },
        fields: [
          { name: "year", type: "text", annotations: {} },
          { name: "municipality", type: "text", annotations: {} },
          ...measures.map((name) => ({ name, type: "double", annotations: { unit: "events" } })),
        ],
      };
      const config: SourceConfig = {
        host: "example.test",
        dataset: "annual-budget",
        timeField: "year",
        period: "year",
        windowPeriods: "3",
        dimensions: "municipality",
        series: measures.join(","),
        orderBy: "year DESC,municipality",
        limit: "10000",
      };
      const fetcher: typeof fetch = async (input) => {
        const url = new URL(String(input));
        if (url.pathname.endsWith("/records")) return Response.json({ total_count: records.length, results: [records[0]] });
        if (url.pathname.endsWith("/exports/json")) {
          const years = new Set([...(url.searchParams.get("where") ?? "").matchAll(/'(\d{4})'/g)].map((match) => match[1]));
          return Response.json(records.filter((row) => years.has(String(row.year))));
        }
        return Response.json(metadata);
      };
      const collector = opendatasoftCollector({ config, hosts: "example.test", fetcher });
      const resolved = await collector.resolve(config);
      const unique = new Set<string>();
      let before = "2023-01-01T00:00:00.000Z";
      let exhausted = false;
      let slices = 0;
      while (!exhausted) {
        slices += 1;
        expect(slices).toBeLessThanOrEqual(4);
        const request: CollectionRequest = {
          protocol: NORMALIZED_PROTOCOL,
          collectionId: `history-budget-${slices}`,
          feed: { id: "history-budget", slug: "history-budget-feed", title: "Annual indicators", description: "Synthetic history boundary regression" },
          resolved,
          feedEpoch: "history-budget",
          mode: { kind: "history", cursor: { before } },
          deadline: new Date(Date.now() + 60_000).toISOString(),
          observedAt: "2026-09-16T00:00:00Z",
          limits: {
            sourceBytes: 8 * 1024 * 1024,
            outputBytes: 16 * 1024 * 1024,
            frameBytes: 1024 * 1024,
            recordBytes: 512 * 1024,
            records: MAX_HISTORY_NORMALIZED_ROWS,
            products: 32,
          },
        };
        const result = await collectNormalized(request, collector);
        if (result.kind !== "batch") throw new Error(JSON.stringify(result));
        const text = await new Response(result.stream).text();
        const periods = new Map<string, number>();
        let sawCompletion = false;
        for (const line of text.trim().split("\n")) {
          const frame = parseJson(line);
          if (!isNormalizedFrame(frame)) throw new Error("Invalid frame");
          if (frame.type === "point") {
            const key = JSON.stringify([frame.productKey, frame.value.seriesKey, frame.value.eventTime]);
            expect(unique.has(key)).toBe(false);
            unique.add(key);
            expect(frame.value.eventTime < before).toBe(true);
            periods.set(frame.value.eventTime, (periods.get(frame.value.eventTime) ?? 0) + 1);
          }
          if (frame.type === "complete") {
            sawCompletion = true;
            expect(frame.counts.points).toBeLessThanOrEqual(MAX_HISTORY_NORMALIZED_ROWS);
            if (slices === 1) expect(frame.counts.points).toBe(measureCount === 10 ? 19_460 : 17_792);
            exhausted = frame.exhausted === true;
            if (!exhausted) {
              if (!frame.nextCursor) throw new Error("Missing continuation");
              expect(frame.nextCursor.before < before).toBe(true);
              before = frame.nextCursor.before;
            }
          }
        }
        expect(sawCompletion).toBe(true);
        for (const count of periods.values()) expect(count).toBe(278 * measureCount);
      }
      expect(unique.size).toBe(records.length * measureCount);
    }, 30_000);
  }

  it("partitions an oversized single text-year cohort with the same measure-aware bound", async () => {
    const measures = Array.from({ length: 32 }, (_, index) => `m${index}`);
    const records = Array.from({ length: 2000 }, (_, index): JsonObject => {
      const row: JsonObject = { year: "2022", region: ["a", "b", "c", "d"][Math.floor(index / 500)]!, id: String(index) };
      for (const name of measures) row[name] = index;
      return row;
    });
    const metadata: JsonObject = {
      dataset_id: "dense-budget",
      metas: { default: { title: "Dense indicators", description: "Synthetic partition regression", records_count: records.length } },
      fields: [
        { name: "year", type: "text", annotations: {} },
        { name: "region", type: "text", annotations: {} },
        { name: "id", type: "text", annotations: {} },
        ...measures.map((name) => ({ name, type: "double", annotations: { unit: "events" } })),
      ],
    };
    const config: SourceConfig = {
      host: "example.test",
      dataset: "dense-budget",
      timeField: "year",
      period: "year",
      windowPeriods: "1",
      dimensions: "region,id",
      series: measures.join(","),
      orderBy: "year DESC,region,id",
    };
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      const where = url.searchParams.get("where") ?? "";
      expect(where).not.toMatch(/year\s*(?:<|>=)/);
      if (url.pathname.endsWith("/records")) return Response.json({ total_count: records.length, results: [records[0]] });
      if (url.pathname.endsWith("/facets")) return Response.json({ facets: [{ name: "region", facets: ["a", "b", "c", "d"].map((value) => ({ value })) }] });
      if (url.pathname.endsWith("/exports/json")) {
        const region = /region = '([a-d])'/.exec(where)?.[1];
        return Response.json(region ? records.filter((row) => row.region === region) : records);
      }
      return Response.json(metadata);
    };
    const fetched = await new OpendatasoftSource(new Set(["example.test"]), fetcher).collectHistory(config, { before: "2023-01-01T00:00:00.000Z" });
    if (fetched.kind !== "body") throw new Error("Expected partition body");
    expect(fetched.next).toEqual({ before: "2023-01-01T00:00:00.000Z", offset: 1, token: "region" });
    const transformed = await new OpendatasoftTransformer().transform(toByteStream(fetched.body), {
      feed: {
        slug: "dense-budget-feed",
        title: "Dense indicators",
        description: "Synthetic partition regression",
        config,
        semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
      },
      observedAt: "2026-09-16T00:00:00Z",
    });
    let points = 0;
    for await (const row of transformed.rows) {
      expect(row.point?.dimensions.region).toBe("a");
      points += 1;
    }
    expect(points).toBe(16000);
    expect(points).toBeLessThanOrEqual(MAX_HISTORY_NORMALIZED_ROWS);
    expect(transformed.finish().quality.acceptedRecords).toBe(500);
  });
});

describe("Historical medical-training record ambiguity", () => {
  it("preserves both genuine source records instead of choosing or summing conflicting series values", async () => {
    const example = feedsOf("opendatasoft").find((item) => item.slug === "sns-medical-specialty-training-vacancies-feed");
    if (!example) throw new Error("Missing training example");
    expect(example.config.series).toBeUndefined();
    expect(example.config.idFields).toBe("registo");
    expect(example.config.windowPeriods).toBe("3");
    expect(example.description ?? datasetOf(example).description).toContain("cohort or revision label");
    const document = { ...fixture("vagas-formacao-especializada-internato"), records: fixture("medical-training-2022-records").records };
    const body = new TextEncoder().encode(JSON.stringify(document));
    const result = await new OpendatasoftTransformer().transform(toByteStream(body), {
      feed: {
        slug: example.slug,
        title: example.title,
        description: example.description,
        config: libraryConfig(example.config),
        semantics: { domainSubject: "observation", defaultProductRole: "current-state" },
      },
      observedAt: "2040-01-01T00:00:00Z",
    });
    const rows: NormalizedRow[] = [];
    for await (const row of result.rows) rows.push(row);
    expect(result.products.map((product) => product.kind)).toEqual(["record"]);
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.record?.entityKey)).toEqual(['["5913"]', '["5914"]']);
    expect(rows.map((row) => row.record?.payload.vagas_disponiveis)).toEqual([2, 1]);
    expect(rows.every((row) => row.record?.eventTime === "2022-01-01T00:00:00.000Z")).toBe(true);
    expect(result.finish().quality).toEqual({ acceptedRecords: 2, rejectedRecords: 0 });
  });
});
