import { jsonAs, jsonBody } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import {
  GatekeeperError,
  NORMALIZED_PROTOCOL,
  collectNormalized,
  toByteStream,
  type CanonicalRecord,
  type CollectionRequest,
  type CollectionResult,
  type JsonObject,
  type NormalizedCollector,
  type NormalizedFrame,
  type ResolvedFeed,
  type SeriesPoint,
  type SourceBody,
  type SourceConfig,
  type SourceFetch,
  type TransformContext,
  feedCollector,
  libraryConfig,
  feedNormalizer,
} from "#/index";
import { RUNNABLE } from "#/catalog/index";
import { MAX_HISTORY_DOCUMENT_BYTES, MAX_HISTORY_RECORDS, OPENDATASOFT_FEEDS, OpendatasoftSource } from "#/formats/opendatasoft/opendatasoft";
import { carriedLibraries, feedsOf } from "#/tests/catalog";
import { OpendatasoftTransformer, seriesSlug } from "#/formats/opendatasoft/transform";
import { isProductSlug } from "@open-data-pt/contract";

const ID_FIELD = {
  name: "id",
  label: "ID",
  type: "text",
  annotations: { id: true, sortable: true },
};
const VALUE_FIELD = { name: "value", label: "Value", type: "int", annotations: {} };

const metadata = {
  dataset_id: "sample-dataset",
  metas: {
    default: {
      title: "Sample dataset",
      description: "<p>A sample.</p>",
      publisher: "Sample publisher",
      license: "CC BY 4.0",
      modified: "2026-09-07T11:00:51.432000+00:00",
      data_processed: "2026-09-07T11:00:51.432000+00:00",
      records_count: 2,
    },
  },
  fields: [ID_FIELD, VALUE_FIELD],
};

const ODS_HOSTS = "e-redes.opendatasoft.com,transparencia.sns.gov.pt";
const allowedHosts = new Set(ODS_HOSTS.split(","));

const historyMetadata = {
  ...metadata,
  metas: {
    default: {
      ...metadata.metas.default,
      records_count: 3,
    },
  },
  fields: [
    ID_FIELD,
    {
      name: "observed_at",
      label: "Observed at",
      type: "datetime",
      annotations: { timeserie_precision: "hour", timerangeFilter: true },
    },
    VALUE_FIELD,
  ],
};

function transformContext(): TransformContext {
  return {
    feed: {
      slug: "sample-feed",
      title: "Sample",
      description: "Sample history",
      config: { host: "e-redes.opendatasoft.com", dataset: "sample-dataset" },
      semantics: OPENDATASOFT_FEEDS.dataset.semantics,
    },
    observedAt: "2026-01-01T00:00:00.000Z",
  };
}

function source(fetcher: typeof fetch): OpendatasoftSource {
  return new OpendatasoftSource(allowedHosts, fetcher);
}

/** A feed that walks history, whose own functions run here against configurations no feed has. */
const HISTORY_FEED = RUNNABLE.get("e-redes-national-consumption-feed")!;

function odsCollector(config: SourceConfig, fetcher: typeof fetch): NormalizedCollector {
  return feedCollector(HISTORY_FEED, { ...config, source: "opendatasoft" }, carriedLibraries("opendatasoft"), { fetcher });
}

function bodyOf(fetched: SourceFetch): SourceBody {
  if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
  return fetched;
}

async function documentOf<T>(fetched: SourceFetch): Promise<T> {
  return jsonBody<T>(new Response(toByteStream(bodyOf(fetched).body)));
}

/** Every record and point the streaming transform produced, by product key. */
async function transformed(fetched: SourceFetch): Promise<{ records: CanonicalRecord[]; points: Map<string, SeriesPoint[]> }> {
  const result = await new OpendatasoftTransformer().transform(toByteStream(bodyOf(fetched).body), transformContext());
  const records: CanonicalRecord[] = [];
  const points = new Map<string, SeriesPoint[]>();
  for await (const row of result.rows) {
    if (row.record !== undefined) records.push(row.record);
    else points.set(row.productKey, [...(points.get(row.productKey) ?? []), row.point]);
  }
  result.finish();
  return { records, points };
}

const LIVE_CONFIG: SourceConfig = { host: "e-redes.opendatasoft.com", dataset: "sample-dataset", limit: "10" };

async function request(config: SourceConfig, fetcher: typeof fetch, mode: CollectionRequest["mode"], sourceBytes = 1024 * 1024): Promise<CollectionRequest> {
  const resolved: ResolvedFeed = await odsCollector(config, fetcher).resolve({ ...config, source: "opendatasoft" });
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: "batch_ods",
    feed: { id: "feed_sample", slug: "sample-feed", title: "Sample", description: "Sample dataset" },
    resolved,
    feedEpoch: "epoch-1",
    mode,
    limits: { sourceBytes, outputBytes: 4 * 1024 * 1024, frameBytes: 1024 * 1024, recordBytes: 512 * 1024, records: 1_000, products: 16 },
    deadline: new Date(Date.now() + 30_000).toISOString(),
    observedAt: "2026-09-10T00:00:00.000Z",
  };
}

async function frames(result: CollectionResult): Promise<NormalizedFrame[]> {
  if (result.kind !== "batch") throw new Error(`Expected a batch, got ${JSON.stringify(result)}`);
  const text = await new Response(result.stream).text();
  return text
    .trim()
    .split("\n")
    .map((line) => jsonAs<NormalizedFrame>(line));
}

describe("Opendatasoft Gatekeeper", () => {
  it("ships example feeds whose configurations and policies all validate", () => {
    const instance = source(fetch);
    expect(OPENDATASOFT_FEEDS.dataset.history).toEqual({ minSliceSeconds: 20 });
    const examples = feedsOf("opendatasoft");
    expect(examples).toHaveLength(57);
    for (const example of examples) {
      expect(() => instance.validateConfig(libraryConfig(example.config))).not.toThrow();
      expect(["changes", "latest"]).toContain(example.policy.collection.historyMode);
      expect(Object.keys(example.policy.collection)).not.toContain("allowedLatenessSeconds");
      expect(Object.keys(example.policy.collection)).not.toContain("lateRetentionSeconds");
    }
  });

  it("derives valid series slugs from truncated or unusual measure names", () => {
    expect(seriesSlug("load-feed", "total_value")).toBe("load-feed-total-value-series");
    // SNS field names are cut at 64 characters and can end in an underscore.
    const truncated = seriesSlug("sns-seasonal-flu-vaccination-coverage", "taxa_de_cobertura_com_idade_superior_ou_");
    expect(truncated).toBe("sns-seasonal-flu-vaccination-coverage-taxa-de-cobertura-com-idade-superior-ou-series");
    const long = seriesSlug("feed", `${"a_".repeat(150)}end`);
    for (const slug of [truncated, long, seriesSlug("feed", "__"), seriesSlug("feed", "Ñame (%)")]) {
      expect(isProductSlug(slug), slug).toBe(true);
    }
    expect(long.length).toBeLessThanOrEqual(200);
  });

  it("normalizes a valid config and rejects unsupported ODSQL", () => {
    const instance = source(fetch);
    expect(
      instance.validateConfig({
        host: " E-REDES.OPENDATASOFT.COM ",
        dataset: " SAMPLE-DATASET ",
        where: "value >= 10",
        select: "id, value",
        orderBy: "value DESC",
        limit: "25",
      }),
    ).toEqual({
      host: "e-redes.opendatasoft.com",
      dataset: "sample-dataset",
      where: "value >= 10",
      select: "id, value",
      orderBy: "value DESC",
      limit: "25",
    });
    expect(() =>
      instance.validateConfig({
        host: "e-redes.opendatasoft.com",
        dataset: "sample-dataset",
        where: "value = 1; DROP TABLE records",
      }),
    ).toThrow("unsupported ODSQL characters");
  });

  it("rejects hosts outside the deployment allowlist", () => {
    expect(() =>
      source(fetch).validateConfig({
        host: "internal.example.test",
        dataset: "anything",
      }),
    ).toThrowError(GatekeeperError);
    expect(() =>
      source(fetch).validateConfig({
        host: "https://e-redes.opendatasoft.com/path",
        dataset: "anything",
      }),
    ).toThrow("host must be a hostname");
  });

  it("streams a small export with provenance, completeness and validators", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(
        Response.json([
          { id: "a", value: 1 },
          { id: "b", value: 2 },
        ]),
      );

    const fetched = bodyOf(await source(fetcher).collect(LIVE_CONFIG));

    expect(fetched.provenance).toEqual({
      sourceUrl: "https://e-redes.opendatasoft.com/api/explore/v2.1/catalog/datasets/sample-dataset",
      sourcePublishedAt: "2026-09-07T11:00:51.432Z",
    });
    expect(fetched.completeness).toBe("complete");
    expect(fetched.validator?.etag).toMatch(/^"ods-/);
    expect(fetched.validator?.lastModified).toBe("Mon, 07 Sep 2026 11:00:51 GMT");
    expect(fetched.body).toBeInstanceOf(ReadableStream);
    expect(await documentOf(fetched)).toEqual({
      dataset: metadata,
      records: [
        { id: "a", value: 1 },
        { id: "b", value: 2 },
      ],
    });
    expect(fetcher.mock.calls[1]?.[0].toString()).toBe("https://e-redes.opendatasoft.com/api/explore/v2.1/catalog/datasets/sample-dataset/exports/json");
  });

  it("forwards a checkpoint and reports an upstream 304 as not modified", async () => {
    const fetcher = vi.fn<typeof fetch>(async (_input, init) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe('"ods-v1"');
      expect(headers.get("if-modified-since")).toBe("Mon, 07 Sep 2026 11:00:51 GMT");
      return new Response(null, {
        status: 304,
        headers: { ETag: '"ods-v1"' },
      });
    });

    const fetched = await source(fetcher).collect(
      {
        host: "transparencia.sns.gov.pt",
        dataset: "sample-dataset",
      },
      {
        etag: '"ods-v1"',
        lastModified: "Mon, 07 Sep 2026 11:00:51 GMT",
      },
    );

    expect(fetched).toEqual({ kind: "not-modified", validator: { etag: '"ods-v1"', lastModified: "Mon, 07 Sep 2026 11:00:51 GMT" } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("reports unchanged metadata as not modified without requesting records", async () => {
    const first = bodyOf(await source(vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(Response.json([]))).collect(LIVE_CONFIG));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata));
    const second = await source(fetcher).collect(LIVE_CONFIG, first.validator);
    expect(second).toEqual({ kind: "not-modified", validator: first.validator });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("stops paginated collection at the configured record cap and declares partial", async () => {
    const largeMetadata = structuredClone(metadata);
    largeMetadata.metas.default.records_count = 3;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(largeMetadata))
      .mockResolvedValueOnce(
        Response.json({
          total_count: 3,
          results: [
            { id: "a", value: 1 },
            { id: "b", value: 2 },
          ],
        }),
      );

    const fetched = bodyOf(
      await source(fetcher).collect({
        host: "e-redes.opendatasoft.com",
        dataset: "sample-dataset",
        orderBy: "id",
        limit: "2",
      }),
    );

    expect(fetched.completeness).toBe("partial");
    expect((await documentOf<{ records: JsonObject[] }>(fetched)).records).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    const url = new URL(fetcher.mock.calls[1]?.[0].toString() ?? "");
    expect(url.pathname.endsWith("/records")).toBe(true);
    expect(url.searchParams.get("order_by")).toBe("id");
    expect(url.searchParams.get("offset")).toBe("0");
    expect(url.searchParams.get("limit")).toBe("2");
  });

  it("streams later pages lazily as one body and declares a filtered selection complete", async () => {
    const largeMetadata = structuredClone(metadata);
    largeMetadata.metas.default.records_count = 500;
    const rows = Array.from({ length: 150 }, (_, index) => ({ id: `r${index}`, value: index }));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(largeMetadata))
      .mockResolvedValueOnce(Response.json({ total_count: 150, results: rows.slice(0, 100) }))
      .mockResolvedValueOnce(Response.json({ total_count: 150, results: rows.slice(100) }));

    const fetched = bodyOf(
      await source(fetcher).collect({
        host: "e-redes.opendatasoft.com",
        dataset: "sample-dataset",
        where: "value < 150",
        limit: "200",
      }),
    );

    expect(fetched.completeness).toBe("complete");
    // Only the first page is requested before the body is read.
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect((await documentOf<{ records: JsonObject[] }>(fetched)).records).toEqual(rows);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const second = new URL(fetcher.mock.calls[2]?.[0].toString() ?? "");
    expect(second.searchParams.get("offset")).toBe("100");
    expect(second.searchParams.get("limit")).toBe("100");
    expect(second.searchParams.get("where")).toBe("value < 150");
    expect(second.searchParams.get("order_by")).toBe("id");
  });

  it("fails the streamed body when a later page breaks", async () => {
    const largeMetadata = structuredClone(metadata);
    largeMetadata.metas.default.records_count = 500;
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(largeMetadata))
      .mockResolvedValueOnce(Response.json({ total_count: 150, results: Array.from({ length: 100 }, (_, index) => ({ id: `r${index}` })) }))
      .mockResolvedValueOnce(new Response("unavailable", { status: 503 }));

    const fetched = await source(fetcher).collect({ host: "e-redes.opendatasoft.com", dataset: "sample-dataset", limit: "200" });
    await expect(documentOf(fetched)).rejects.toMatchObject({ code: "upstream-error" });
  });

  it("collects one history slice with a transform-compatible document and backwards cursor", async () => {
    const records = [
      { id: "newer", observed_at: "2025-12-31T23:00:00+00:00", value: 2 },
      { id: "older", observed_at: "2025-12-28T12:00:00+00:00", value: 1 },
    ];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(historyMetadata))
      .mockResolvedValueOnce(
        Response.json({
          total_count: 3,
          results: [{ id: "first", observed_at: "2020-01-01T00:00:00+00:00", value: 0 }],
        }),
      )
      .mockResolvedValueOnce(Response.json(records));

    const fetched = bodyOf(
      await source(fetcher).collectHistory(
        {
          host: "e-redes.opendatasoft.com",
          dataset: "sample-dataset",
        },
        { before: "2026-01-01T00:00:00Z" },
      ),
    );

    expect(fetched.next).toEqual({ before: "2025-12-28T12:00:00.000Z" });
    expect(fetched.exhausted).toBeUndefined();
    expect(fetched.completeness).toBe("complete");
    expect(fetched.provenance.sourceUrl).toContain("/sample-dataset/exports/json?");
    expect(await documentOf(fetched)).toEqual({ dataset: historyMetadata, records });

    const normalized = await transformed(fetched);
    expect(normalized.records.map((record) => record.eventTime)).toEqual(["2025-12-31T23:00:00.000Z", "2025-12-28T12:00:00.000Z"]);
    // Without a `series` list the dataset is published once, as its table.
    expect(normalized.points.size).toBe(0);

    const earliestUrl = new URL(fetcher.mock.calls[1]?.[0].toString() ?? "");
    expect(earliestUrl.pathname.endsWith("/records")).toBe(true);
    expect(earliestUrl.searchParams.get("order_by")).toBe("observed_at");
    expect(earliestUrl.searchParams.get("limit")).toBe("1");
    const exportUrl = new URL(fetcher.mock.calls[2]?.[0].toString() ?? "");
    expect(exportUrl.searchParams.get("where")).toBe("observed_at >= '2025-12-25T00:00:00Z' AND observed_at < '2026-01-01T00:00:00Z'");
    expect(exportUrl.searchParams.get("order_by")).toBe("observed_at DESC");
  });

  it("halves the history span when an export exceeds the document cap", async () => {
    const huge = new Response(new Uint8Array(MAX_HISTORY_DOCUMENT_BYTES + 1), {
      headers: { "content-type": "application/json", "content-length": String(MAX_HISTORY_DOCUMENT_BYTES + 1) },
    });
    const records = [{ id: "a", observed_at: "2025-12-30T00:00:00+00:00", value: 1 }];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(historyMetadata))
      .mockResolvedValueOnce(Response.json({ total_count: 3, results: [{ id: "first", observed_at: "2020-01-01T00:00:00+00:00", value: 0 }] }))
      .mockResolvedValueOnce(huge)
      .mockResolvedValueOnce(Response.json(records));

    bodyOf(await source(fetcher).collectHistory({ host: "e-redes.opendatasoft.com", dataset: "sample-dataset" }, { before: "2026-01-01T00:00:00Z" }));
    const first = new URL(fetcher.mock.calls[2]?.[0].toString() ?? "");
    const second = new URL(fetcher.mock.calls[3]?.[0].toString() ?? "");
    expect(first.searchParams.get("where")).toContain("observed_at >= '2025-12-25T00:00:00Z'");
    // Seven days became three and a half.
    expect(second.searchParams.get("where")).toContain("observed_at >= '2025-12-28T12:00:00Z'");
  });

  it("partitions a dense timestamp by a facet when the cursor carries an offset", async () => {
    const metadata = {
      ...historyMetadata,
      // Only one text field, so the partition candidate is unambiguous.
      fields: [...historyMetadata.fields.filter((field) => field.type !== "text"), { name: "district", type: "text", annotations: {} }],
    };
    const row = (district: string, n: number) => ({ id: `${district}-${n}`, observed_at: "2026-06-01T00:00:00+00:00", district, value: n });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(Response.json({ total_count: 9, results: [{ id: "first", observed_at: "2020-01-01T00:00:00+00:00", value: 0 }] }))
      // latest timestamp below the cursor
      .mockResolvedValueOnce(Response.json({ total_count: 3, results: [row("01", 0)] }))
      // facets for the only text candidate
      .mockResolvedValueOnce(
        Response.json({
          facets: [
            {
              name: "district",
              facets: [
                { name: "01", value: "01", count: 2 },
                { name: "02", value: "02", count: 1 },
                { name: "03", value: "03", count: 1 },
              ],
            },
          ],
        }),
      )
      // partition exports from offset 1 onwards
      .mockResolvedValueOnce(Response.json([row("02", 1)]))
      .mockResolvedValueOnce(Response.json([row("03", 2)]));

    const fetched = bodyOf(await source(fetcher).collectHistory({ host: "e-redes.opendatasoft.com", dataset: "sample-dataset" }, { before: "2026-07-01T00:00:00Z", offset: 1 }));
    const document = await documentOf<{ records: Array<{ id: string }> }>(fetched);
    expect(document.records.map((r) => r.id)).toEqual(["02-1", "03-2"]);
    // Every partition delivered: the next cursor moves down to the timestamp itself.
    expect(fetched.next).toEqual({ before: "2026-06-01T00:00:00.000Z" });
    const partitionUrl = new URL(fetcher.mock.calls[4]?.[0].toString() ?? "");
    expect(partitionUrl.searchParams.get("where")).toContain("district = '02'");
  });

  it("caps dense exports without splitting equal timestamps at the cursor", async () => {
    const before = Date.parse("2026-01-01T00:00:00Z");
    const records = Array.from({ length: MAX_HISTORY_RECORDS + 3 }, (_, index) => ({
      id: String(index),
      observed_at: new Date(before - (index === MAX_HISTORY_RECORDS + 2 ? MAX_HISTORY_RECORDS + 1 : Math.min(index + 1, MAX_HISTORY_RECORDS)) * 60_000).toISOString(),
      value: index,
    }));
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(historyMetadata))
      .mockResolvedValueOnce(
        Response.json({
          total_count: records.length + 1,
          results: [{ id: "first", observed_at: "2020-01-01T00:00:00Z", value: 0 }],
        }),
      )
      .mockResolvedValueOnce(Response.json(records));

    const fetched = bodyOf(
      await source(fetcher).collectHistory(
        {
          host: "e-redes.opendatasoft.com",
          dataset: "sample-dataset",
        },
        { before: "2026-01-01T00:00:00Z" },
      ),
    );
    const document = await documentOf<{ records: Array<JsonObject> }>(fetched);

    expect(document.records).toHaveLength(MAX_HISTORY_RECORDS + 2);
    const cutoff = new Date(before - MAX_HISTORY_RECORDS * 60_000).toISOString();
    expect(fetched.next).toEqual({ before: cutoff });
  });

  it("reports exhaustion at the earliest boundary without requesting an export", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(historyMetadata))
      .mockResolvedValueOnce(
        Response.json({
          total_count: 1,
          results: [{ id: "first", observed_at: "2020-01-01T00:00:00Z", value: 0 }],
        }),
      );

    expect(
      await source(fetcher).collectHistory(
        {
          host: "e-redes.opendatasoft.com",
          dataset: "sample-dataset",
        },
        { before: "2020-01-01T00:00:00Z" },
      ),
    ).toEqual({ kind: "exhausted" });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("uses a ten-calendar-year monthly slice across a year boundary", async () => {
    const monthlyMetadata = structuredClone(historyMetadata);
    monthlyMetadata.fields[1] = {
      name: "observed_at",
      label: "Observed at",
      type: "date",
      annotations: { timeserie_precision: "month", timerangeFilter: true },
    };
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(monthlyMetadata))
      .mockResolvedValueOnce(
        Response.json({
          total_count: 2,
          results: [{ id: "first", observed_at: "2013-01", value: 0 }],
        }),
      )
      .mockResolvedValueOnce(Response.json([{ id: "last-year", observed_at: "2025-12", value: 1 }]));

    bodyOf(
      await source(fetcher).collectHistory(
        {
          host: "transparencia.sns.gov.pt",
          dataset: "sample-dataset",
        },
        { before: "2026-01-01T00:00:00Z" },
      ),
    );

    const exportUrl = new URL(fetcher.mock.calls[2]?.[0].toString() ?? "");
    expect(exportUrl.searchParams.get("where")).toBe("observed_at >= '2016-01-01' AND observed_at < '2026-01-01'");
  });

  it("reports exhaustion when metadata has no annotated time field", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata));
    expect(
      await source(fetcher).collectHistory(
        {
          host: "e-redes.opendatasoft.com",
          dataset: "sample-dataset",
        },
        { before: "2026-01-01T00:00:00Z" },
      ),
    ).toEqual({ kind: "exhausted" });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it.each([429, 503])("maps upstream HTTP %i during history collection to a retryable error", async (status) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("retry later", { status }));
    await expect(
      source(fetcher).collectHistory(
        {
          host: "e-redes.opendatasoft.com",
          dataset: "sample-dataset",
        },
        { before: "2026-01-01T00:00:00Z" },
      ),
    ).rejects.toMatchObject({ code: "upstream-error" });
  });

  it("carries Retry-After seconds on an upstream error", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("slow down", { status: 429, headers: { "Retry-After": "120" } }));
    await expect(source(fetcher).collect(LIVE_CONFIG)).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: 120,
    });
  });

  it("surfaces provider errors without attempting a data request", async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response("unavailable", { status: 503 }));

    await expect(
      source(fetcher).collect({
        host: "transparencia.sns.gov.pt",
        dataset: "sample-dataset",
      }),
    ).rejects.toMatchObject({ code: "upstream-error" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

it("explicitly exhausts a terminal Opendatasoft slice only at the verified earliest observation", async () => {
  const earliest = { id: "first", observed_at: "2020-01-01T00:00:00+00:00", value: 1 };
  let call = 0;
  const fetcher: typeof fetch = async () => {
    call++;
    if (call === 1) return Response.json(historyMetadata);
    if (call === 2) return Response.json({ total_count: 1, results: [earliest] });
    return Response.json([earliest]);
  };
  const fetched = bodyOf(await source(fetcher).collectHistory({ host: "e-redes.opendatasoft.com", dataset: "sample-dataset" }, { before: "2020-01-02T00:00:00Z" }));
  expect(fetched.next).toBeUndefined();
  expect(fetched.exhausted).toBe(true);
});

describe("Opendatasoft through the shared collector", () => {
  it("streams header, records, points and completion frames for a live export", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(metadata))
      .mockResolvedValueOnce(
        Response.json([
          { id: "a", value: 1 },
          { id: "b", value: 2 },
        ]),
      );
    const req = await request(LIVE_CONFIG, fetcher, { kind: "live" });
    const [header, ...rest] = await frames(await collectNormalized(req, odsCollector(LIVE_CONFIG, fetcher)));

    if (header?.type !== "header") throw new Error("Expected a header frame first");
    expect(header.provenance).toEqual({
      sourceUrl: "https://e-redes.opendatasoft.com/api/explore/v2.1/catalog/datasets/sample-dataset",
      sourcePublishedAt: "2026-09-07T11:00:51.432Z",
    });
    expect(header.completeness).toBe("complete");
    expect(header.normalizer).toEqual(feedNormalizer({ id: "opendatasoft-explore-v2.1", version: "6" }));
    expect(header.products.map((product) => [product.productKey, product.completeness])).toEqual([["records", "complete"]]);
    expect(header.checkpoint.state).toMatchObject({ validators: { default: { etag: expect.stringMatching(/^"ods-/) } } });
    expect(rest.filter((frame) => frame.type === "record").map((frame) => frame.type === "record" && frame.value.entityKey)).toEqual(["a", "b"]);
    const complete = rest.at(-1);
    if (complete?.type !== "complete") throw new Error("Expected a completion frame last");
    expect(complete.counts).toEqual({ records: 2, points: 0 });
    expect(complete.quality).toEqual({ acceptedRecords: 2, rejectedRecords: 0 });
    expect(complete.products?.[0]).toMatchObject({
      productKey: "records",
      schema: { fields: expect.arrayContaining([expect.objectContaining({ id: "value", type: "number", nullable: false })]) },
    });
  });

  it("carries the history continuation and terminal exhaustion", async () => {
    const config: SourceConfig = { host: "e-redes.opendatasoft.com", dataset: "sample-dataset", series: "value" };
    const sliceFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(historyMetadata))
      .mockResolvedValueOnce(Response.json({ total_count: 3, results: [{ id: "first", observed_at: "2020-01-01T00:00:00+00:00", value: 0 }] }))
      .mockResolvedValueOnce(
        Response.json([
          { id: "newer", observed_at: "2025-12-31T23:00:00+00:00", value: 2 },
          { id: "older", observed_at: "2025-12-28T12:00:00+00:00", value: 1 },
        ]),
      );
    const sliceRequest = await request(config, sliceFetcher, { kind: "history", cursor: { before: "2026-01-01T00:00:00.000Z" } });
    const slice = await frames(await collectNormalized(sliceRequest, odsCollector(config, sliceFetcher)));
    const header = slice[0];
    if (header?.type !== "header") throw new Error("Expected a header frame first");
    expect(header.completeness).toBe("complete");
    expect(slice.filter((frame) => frame.type === "point")).toHaveLength(2);
    const complete = slice.at(-1);
    if (complete?.type !== "complete") throw new Error("Expected a completion frame last");
    expect(complete.nextCursor).toEqual({ before: "2025-12-28T12:00:00.000Z" });
    expect(complete.exhausted).toBeUndefined();
    expect(complete.products).toEqual(expect.arrayContaining([{ productKey: "series:value", watermark: "2025-12-31T23:00:00.000Z" }]));

    const boundaryFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(historyMetadata))
      .mockResolvedValueOnce(Response.json({ total_count: 1, results: [{ id: "first", observed_at: "2020-01-01T00:00:00Z", value: 0 }] }));
    const boundaryRequest = await request(config, boundaryFetcher, { kind: "history", cursor: { before: "2020-01-01T00:00:00.000Z" } });
    expect(await collectNormalized(boundaryRequest, odsCollector(config, boundaryFetcher))).toMatchObject({
      kind: "exhausted",
    });

    const earliest = { id: "first", observed_at: "2020-01-01T00:00:00+00:00", value: 1 };
    const terminalFetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(historyMetadata))
      .mockResolvedValueOnce(Response.json({ total_count: 1, results: [earliest] }))
      .mockResolvedValueOnce(Response.json([earliest]));
    const terminalRequest = await request(config, terminalFetcher, { kind: "history", cursor: { before: "2020-01-02T00:00:00.000Z" } });
    const terminal = (await frames(await collectNormalized(terminalRequest, odsCollector(config, terminalFetcher)))).at(-1);
    if (terminal?.type !== "complete") throw new Error("Expected a completion frame last");
    expect(terminal.exhausted).toBe(true);
    expect(terminal.nextCursor).toBeUndefined();
  });

  it("reports a source body over the collection byte budget as too large", async () => {
    const rows = Array.from({ length: 2 }, (_, index) => ({ id: `r${index}`, value: index, note: "x".repeat(4_000) }));
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(metadata)).mockResolvedValueOnce(Response.json(rows));
    const req = await request(LIVE_CONFIG, fetcher, { kind: "live" }, 4_096);
    expect(await collectNormalized(req, odsCollector(LIVE_CONFIG, fetcher))).toEqual({
      kind: "failure",
      code: "response-too-large",
      retryable: false,
    });
  });

  it("maps a provider error to a retryable typed failure", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("slow down", { status: 503, headers: { "Retry-After": "30" } }));
    const req = await request(LIVE_CONFIG, fetcher, { kind: "live" });
    expect(await collectNormalized(req, odsCollector(LIVE_CONFIG, fetcher))).toEqual({
      kind: "failure",
      code: "upstream-error",
      retryable: true,
      retryAfterSeconds: 30,
    });
  });
});
