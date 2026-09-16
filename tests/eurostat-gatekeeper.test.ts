import { describe, expect, it, vi } from "vitest";
import type { JsonObject, JsonValue, SourceBody, SourceFetch, TransformContext } from "@open-data-pt/gatekeeper-shared";
import {
  EUROSTAT_FEEDS,
  EUROSTAT_MAX_BYTES,
  collectEurostatDataset,
  collectEurostatDatasetHistory,
  validateEurostatFeedConfig,
} from "../packages/gatekeeper-shared/src/sources/eurostat/eurostat";
import { transformEurostatDataset } from "../packages/gatekeeper-shared/src/sources/eurostat/transform";

const SOURCE_URL = "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?age=TOTAL&geo=ES&geo=PT&sex=T&lang=EN&lastTimePeriod=3";
const DATASET = {
  version: "2.0",
  class: "dataset",
  label: "Unemployment by sex and age - monthly data",
  source: "ESTAT",
  updated: "2026-09-04T23:00:00+0200",
  id: ["unit", "geo", "time"],
  size: [1, 2, 1],
  dimension: {
    unit: {
      label: "Unit of measure",
      category: {
        index: { PC_ACT: 0 },
        label: { PC_ACT: "Percentage of population in the labour force" },
      },
    },
    geo: {
      label: "Geopolitical entity (reporting)",
      category: {
        index: { PT: 0, ES: 1 },
        label: { PT: "Portugal", ES: "Spain" },
      },
    },
    time: {
      label: "Time",
      category: { index: { "2026-08": 0 }, label: { "2026-08": "2026-08" } },
    },
  },
  role: { time: ["time"], geo: ["geo"], metric: ["unit"] },
  value: { "0": 5.7, "1": 10.3 },
};

function jsonResponse(value: JsonValue | undefined, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
}

function historyDataset(periods: string[], values: Record<string, number> = {}): JsonObject {
  const index = Object.fromEntries(periods.map((period, position) => [period, position]));
  return {
    version: "2.0",
    class: "dataset",
    label: "History",
    updated: "2026-09-04T23:00:00+0200",
    id: ["freq", "geo", "time"],
    size: [1, 1, periods.length],
    dimension: {
      freq: { label: "Frequency", category: { index: { M: 0 }, label: { M: "Monthly" } } },
      geo: { label: "Geography", category: { index: { PT: 0 }, label: { PT: "Portugal" } } },
      time: { label: "Time", category: { index, label: Object.fromEntries(periods.map((period) => [period, period])) } },
    },
    role: { time: ["time"], geo: ["geo"] },
    value: values,
  };
}

function transformContext(): TransformContext {
  return {
    feed: {
      id: "feed_eurostat_history",
      slug: "eurostat-history",
      title: "Eurostat history",
      description: "test",
      config: { dataset: "une_rt_m" },
      semantics: EUROSTAT_FEEDS.dataset.semantics,
    },
    observedAt: "2026-09-08T00:00:00Z",
  };
}

function sourceBody(fetched: SourceFetch): SourceBody {
  if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
  return fetched;
}

function bodyText(fetched: SourceBody): string {
  if (!(fetched.body instanceof Uint8Array)) throw new Error("Expected buffered source bytes");
  return new TextDecoder().decode(fetched.body);
}

describe("Eurostat Gatekeeper", () => {
  it("normalizes configuration, repeated filters, defaults, and query order", () => {
    expect(
      validateEurostatFeedConfig({
        dataset: " UNE_RT_M ",
        filters: "sex=T&geo=PT&age=TOTAL&geo=ES",
        lastTimePeriod: "003",
        lang: "en",
      }),
    ).toEqual({
      dataset: "une_rt_m",
      filters: "age=TOTAL&geo=ES&geo=PT&sex=T",
      lastTimePeriod: "3",
      lang: "EN",
    });
    expect(validateEurostatFeedConfig({ dataset: "prc_hpi_q" })).toEqual({
      dataset: "prc_hpi_q",
      filters: "geo=PT",
      lastTimePeriod: "120",
      lang: "EN",
    });
  });

  it("rejects malformed configuration and caller-provided hosts", () => {
    expect(() => validateEurostatFeedConfig({ dataset: "../secret" })).toThrow("dataset to match");
    expect(() =>
      validateEurostatFeedConfig({
        dataset: "une_rt_m",
        filters: "geo=PT&bad-key=value with spaces",
      }),
    ).toThrow("filter key");
    expect(() =>
      validateEurostatFeedConfig({
        dataset: "une_rt_m",
        filters: "geo=PT&lang=FR",
      }),
    ).toThrow("cannot override lang");
    expect(() =>
      validateEurostatFeedConfig({
        dataset: "une_rt_m",
        filters: "geo=PT&untilTimePeriod=2020-01",
      }),
    ).toThrow("cannot override untilTimePeriod");
    expect(() =>
      validateEurostatFeedConfig({
        dataset: "une_rt_m",
        lastTimePeriod: "601",
      }),
    ).toThrow("1 to 600");
    expect(() =>
      validateEurostatFeedConfig({
        dataset: "une_rt_m",
        host: "attacker.example",
      }),
    ).toThrow("does not accept host");
    expect(() =>
      validateEurostatFeedConfig({
        dataset: "irt_lt_mcby_m",
        unit: "<script>alert(1)</script>",
      }),
    ).toThrow("plain text");
    expect(() =>
      validateEurostatFeedConfig({
        dataset: "irt_lt_mcby_m",
        unit: "x".repeat(81),
      }),
    ).toThrow("at most 80 characters");
  });

  it("keeps a stated unit for datasets without a unit dimension", () => {
    expect(validateEurostatFeedConfig({ dataset: "irt_lt_mcby_m", unit: " Percentage per annum " })).toMatchObject({
      dataset: "irt_lt_mcby_m",
      unit: "Percentage per annum",
    });
    expect(validateEurostatFeedConfig({ dataset: "irt_lt_mcby_m" })).not.toHaveProperty("unit");
  });

  it("rejects a deployment origin outside the Eurostat allowlist", async () => {
    await expect(collectEurostatDataset({ dataset: "une_rt_m" }, undefined, "https://attacker.example", vi.fn())).rejects.toMatchObject({ code: "source-denied" });
  });

  it("collects untouched JSON-stat bytes with provenance and a publication validator", async () => {
    const sourceBytes = JSON.stringify(DATASET, null, 2);
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(input.toString()).toBe(SOURCE_URL);
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe('"old"');
      expect(headers.get("if-modified-since")).toBe("Thu, 03 Sep 2026 21:00:00 GMT");
      return new Response(sourceBytes, {
        headers: {
          "Content-Type": "application/json",
          ETag: '"upstream"',
          "Last-Modified": "Fri, 04 Sep 2026 21:00:00 GMT",
        },
      });
    });

    const collected = sourceBody(
      await collectEurostatDataset(
        {
          dataset: "une_rt_m",
          filters: "sex=T&geo=PT&age=TOTAL&geo=ES",
          lastTimePeriod: "3",
          lang: "EN",
        },
        {
          etag: '"old"',
          lastModified: "Thu, 03 Sep 2026 21:00:00 GMT",
        },
        "https://ec.europa.eu",
        fetcher,
      ),
    );

    expect(collected).toMatchObject({
      provenance: {
        sourceUrl: SOURCE_URL,
        sourcePublishedAt: "2026-09-04T21:00:00.000Z",
      },
      completeness: "complete",
      validator: {
        etag: '"une_rt_m:2026-09-04T21:00:00.000Z"',
        lastModified: "Fri, 04 Sep 2026 21:00:00 GMT",
      },
    });
    expect(collected.next).toBeUndefined();
    expect(collected.exhausted).toBeUndefined();
    expect(bodyText(collected)).toBe(sourceBytes);
  });

  it("reports not-modified when the parsed publication checkpoint is unchanged", async () => {
    const etag = '"une_rt_m:2026-09-04T21:00:00.000Z"';
    const fetcher = vi.fn(async () => jsonResponse(DATASET));
    const fetched = await collectEurostatDataset({ dataset: "une_rt_m", lastTimePeriod: "3" }, { etag }, "https://ec.europa.eu", fetcher);

    expect(fetched).toEqual({ kind: "not-modified", validator: { etag } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("maps an upstream 304 to not-modified with its current ETag", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 304, headers: { ETag: '"upstream-new"' } }));
    const fetched = await collectEurostatDataset(
      { dataset: "une_rt_m" },
      { etag: '"upstream-old"', lastModified: "Thu, 03 Sep 2026 21:00:00 GMT" },
      "https://ec.europa.eu",
      fetcher,
    );
    expect(fetched).toEqual({
      kind: "not-modified",
      validator: {
        etag: '"upstream-new"',
        lastModified: "Thu, 03 Sep 2026 21:00:00 GMT",
      },
    });
  });

  it("enforces the 8 MiB response cap", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("{}", {
          headers: { "Content-Length": String(EUROSTAT_MAX_BYTES + 1) },
        }),
    );
    await expect(collectEurostatDataset({ dataset: "une_rt_m" }, undefined, "https://ec.europa.eu", fetcher)).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("maps Eurostat 400 errors to non-retryable invalid configuration", async () => {
    const fetcher = vi.fn(async () =>
      jsonResponse(
        {
          error: [
            {
              status: 400,
              label: 'INVALID_QUERY_DIMENSION: Dimension "UNKNOWN" is not defined',
            },
          ],
        },
        { status: 400 },
      ),
    );
    await expect(collectEurostatDataset({ dataset: "une_rt_m" }, undefined, "https://ec.europa.eu", fetcher)).rejects.toMatchObject({
      code: "invalid-config",
      message: expect.stringContaining("UNKNOWN"),
    });
  });

  it("maps provider and request failures to upstream errors", async () => {
    const providerError = vi.fn(async () => new Response("temporary failure", { status: 503 }));
    await expect(collectEurostatDataset({ dataset: "une_rt_m" }, undefined, "https://ec.europa.eu", providerError)).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: undefined,
    });

    const throttled = vi.fn(async () => new Response("slow down", { status: 503, headers: { "Retry-After": "120" } }));
    await expect(collectEurostatDataset({ dataset: "une_rt_m" }, undefined, "https://ec.europa.eu", throttled)).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: 120,
      message: "Eurostat returned HTTP 503",
    });

    const requestError = vi.fn(async () => {
      throw new Error("request timed out");
    });
    await expect(collectEurostatDataset({ dataset: "une_rt_m" }, undefined, "https://ec.europa.eu", requestError)).rejects.toMatchObject({ code: "upstream-error" });
  });

  it("rejects malformed successful provider payloads before capture", async () => {
    const missingUpdated = vi.fn(async () => jsonResponse({ ...DATASET, updated: null }));
    await expect(collectEurostatDataset({ dataset: "une_rt_m" }, undefined, "https://ec.europa.eu", missingUpdated)).rejects.toMatchObject({ code: "invalid-response" });

    const invalidSparseIndex = vi.fn(async () => jsonResponse({ ...DATASET, value: { "2": 5.7 } }));
    await expect(collectEurostatDataset({ dataset: "une_rt_m" }, undefined, "https://ec.europa.eu", invalidSparseIndex)).rejects.toMatchObject({
      code: "invalid-response",
      message: expect.stringContaining("index exceeded"),
    });
  });
});

describe("Eurostat history", () => {
  it("declares history and returns a transformable monthly slice with its next cursor", async () => {
    expect(EUROSTAT_FEEDS.dataset.history).toEqual({});
    const document = historyDataset(["2014-01", "2023-12"], { "0": 9.1, "1": 6.4 });
    const sourceBytes = JSON.stringify(document, null, 2);
    const expectedUrl =
      "https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/une_rt_m?age=TOTAL&geo=PT&sex=T&lang=EN&sinceTimePeriod=2014-01&untilTimePeriod=2023-12";
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(input.toString()).toBe(expectedUrl);
      expect(new Headers(init?.headers).get("accept")).toBe("application/json");
      return new Response(sourceBytes, {
        headers: { "Content-Type": "application/json" },
      });
    });

    const slice = sourceBody(
      await collectEurostatDatasetHistory(
        {
          dataset: "une_rt_m",
          filters: "sex=T&geo=PT&age=TOTAL",
          lastTimePeriod: "120",
          lang: "EN",
        },
        { before: "2024-01-01T00:00:00Z" },
        "https://ec.europa.eu",
        fetcher,
      ),
    );

    expect(slice).toMatchObject({
      provenance: {
        sourceUrl: expectedUrl,
        sourcePublishedAt: "2026-09-04T21:00:00.000Z",
      },
      completeness: "complete",
      next: { before: "2014-01-01T00:00:00Z" },
    });
    expect(slice.exhausted).toBeUndefined();
    expect(slice.validator).toBeUndefined();
    expect(bodyText(slice)).toBe(sourceBytes);

    const transformed = transformEurostatDataset(new TextEncoder().encode(sourceBytes), transformContext());
    expect(transformed.quality.acceptedRecords).toBe(2);
    expect(transformed.products[0]?.points?.map((point) => point.eventTime)).toEqual(["2014-01-01T00:00:00Z", "2023-12-01T00:00:00Z"]);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("reports exhaustion for empty datasets and Eurostat no-data errors", async () => {
    const emptyFetcher = vi.fn(async () => jsonResponse(historyDataset([])));
    const empty = await collectEurostatDatasetHistory({ dataset: "une_rt_m", filters: "freq=M&geo=PT" }, { before: "1983-01-01T00:00:00Z" }, "https://ec.europa.eu", emptyFetcher);
    expect(empty).toEqual({ kind: "exhausted" });

    const noDataFetcher = vi.fn(async () => jsonResponse({ error: [{ status: 400, label: "NO_RESULTS: No data found" }] }, { status: 400 }));
    const noData = await collectEurostatDatasetHistory(
      { dataset: "une_rt_m", filters: "freq=M&geo=PT" },
      { before: "1983-01-01T00:00:00Z" },
      "https://ec.europa.eu",
      noDataFetcher,
    );
    expect(noData).toEqual({ kind: "exhausted" });
  });

  it("builds one 120-quarter slice across a year boundary from an offset cursor", async () => {
    const document = {
      ...historyDataset(["1994-Q1", "2023-Q4"], { "0": 1, "1": 2 }),
      dimension: {
        // SAFETY: `historyDataset` builds its dimension member as an object.
        ...(historyDataset([]).dimension as JsonObject),
        freq: { label: "Frequency", category: { index: { Q: 0 }, label: { Q: "Quarterly" } } },
        geo: { label: "Geography", category: { index: { PT: 0 }, label: { PT: "Portugal" } } },
        time: { label: "Time", category: { index: { "1994-Q1": 0, "2023-Q4": 1 } } },
      },
    };
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.searchParams.get("sinceTimePeriod")).toBe("1994-Q1");
      expect(url.searchParams.get("untilTimePeriod")).toBe("2023-Q4");
      expect(url.searchParams.has("lastTimePeriod")).toBe(false);
      return jsonResponse(document);
    });

    const slice = sourceBody(
      await collectEurostatDatasetHistory(
        {
          dataset: "namq_10_gdp",
          filters: "geo=PT&na_item=B1GQ&s_adj=SCA&unit=CLV10_MEUR",
        },
        { before: "2024-01-01T01:00:00+01:00" },
        "https://ec.europa.eu",
        fetcher,
      ),
    );
    expect(slice.next).toEqual({ before: "1994-01-01T00:00:00Z" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("requests all earlier annual periods in one slice", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.searchParams.has("sinceTimePeriod")).toBe(false);
      expect(url.searchParams.get("untilTimePeriod")).toBe("2023");
      return jsonResponse(historyDataset([]));
    });

    const fetched = await collectEurostatDatasetHistory({ dataset: "demo_pjan", filters: "freq=A&geo=PT" }, { before: "2024-01-01T00:00:00Z" }, "https://ec.europa.eu", fetcher);
    expect(fetched).toEqual({ kind: "exhausted" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("maps history throttling, server failures, and request failures to retryable upstream errors", async () => {
    for (const status of [429, 503]) {
      await expect(
        collectEurostatDatasetHistory(
          { dataset: "une_rt_m" },
          { before: "2024-01-01T00:00:00Z" },
          "https://ec.europa.eu",
          vi.fn(async () => new Response("temporary", { status, headers: { "Retry-After": "30" } })),
        ),
      ).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 30 });
    }
    await expect(
      collectEurostatDatasetHistory(
        { dataset: "une_rt_m" },
        { before: "2024-01-01T00:00:00Z" },
        "https://ec.europa.eu",
        vi.fn(async () => {
          throw new Error("timeout");
        }),
      ),
    ).rejects.toMatchObject({ code: "upstream-error" });
  });
});
