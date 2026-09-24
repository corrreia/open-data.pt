import { RUNNABLE } from "#/catalog/index";
import { describe, expect, it, vi } from "vitest";
import {
  GatekeeperError,
  NORMALIZED_PROTOCOL,
  collectNormalized,
  isJsonObject,
  parseJson,
  type CollectionRequest,
  type CollectionResult,
  type JsonObject,
  feedCollector,
  libraryConfig,
  resolveLibraryFeed,
  feedNormalizer,
} from "#/index";
import { UdataSource, chooseTransformer, resolveUdataFeed, validateUdataFeedConfig } from "#/formats/udata/index";
import { carriedLibraries, feedsOf } from "#/tests/catalog";

const payload = {
  id: "dataset-1",
  slug: "population-by-municipality",
  title: "Population by municipality",
  resources: [
    {
      id: "resource-1",
      title: "CSV distribution",
      url: "https://publisher.example/data.csv",
      format: "csv",
      mime: "text/csv",
      filesize: 24,
      last_modified: "2026-08-24T20:14:58.444000+00:00",
    },
  ],
};

const config = {
  baseUrl: "https://dados.gov.pt",
  dataset: "population",
  distributionId: "resource-1",
  format: "csv",
  productSlug: "population",
  feed: "distribution",
};

const UDATA_HOSTS = "dados.gov.pt";
const LIBRARIES = carriedLibraries("udata");
/** A tabular feed's own functions, run here against a configuration no feed has. */
const TABULAR_FEED = RUNNABLE.get("justice-facilities-feed")!;

/** One collection through a tabular feed's own functions, with the test's fetch. */
function collect(fetcher: typeof fetch, request: CollectionRequest): Promise<CollectionResult> {
  return collectNormalized(request, feedCollector(TABULAR_FEED, { ...config, source: "udata" }, LIBRARIES, { fetcher }));
}

async function request(overrides: Partial<CollectionRequest> = {}): Promise<CollectionRequest> {
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: "batch_1",
    feed: { id: "feed_1", slug: "population-feed", title: "Population", description: "Population by municipality" },
    resolved: await resolveLibraryFeed({ ...config, source: "udata" }, LIBRARIES),
    feedEpoch: "epoch-1",
    mode: { kind: "live" },
    limits: { sourceBytes: 1024 * 1024, outputBytes: 4 * 1024 * 1024, frameBytes: 1024 * 1024, recordBytes: 256 * 1024, records: 1_000, products: 4 },
    deadline: new Date(Date.now() + 30_000).toISOString(),
    observedAt: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

async function frames(stream: ReadableStream<Uint8Array>): Promise<JsonObject[]> {
  const text = await new Response(stream).text();
  return text
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const value = parseJson(line);
      if (!isJsonObject(value)) throw new Error("Every frame must be an object");
      return value;
    });
}

describe("UdataSource", () => {
  it("streams only a distribution declared by the bound dataset, with its provenance and validators", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(
        new Response("name,value\nLisbon,42\n", {
          headers: { "Content-Type": "text/csv", ETag: '"v1"' },
        }),
      );
    const source = new UdataSource(new Set(["dados.gov.pt"]), fetcher);

    const fetched = await source.fetchDistribution({ baseUrl: "https://dados.gov.pt", dataset: "population" }, { kind: "id", id: "resource-1" });

    expect(fetched).toMatchObject({
      kind: "body",
      provenance: { sourceUrl: "https://publisher.example/data.csv", sourcePublishedAt: "2026-08-24T20:14:58.444Z" },
      completeness: "complete",
      state: { resource: "resource-1", validators: { default: { etag: '"v1"' } } },
    });
    if (fetched.kind !== "body") return;
    expect(fetched.body).toBeInstanceOf(ReadableStream);
    expect(await new Response(fetched.body).text()).toContain("Lisbon,42");
    expect(fetcher.mock.calls[1]?.[0].toString()).toBe("https://dados.gov.pt/api/1/datasets/r/resource-1");
  });

  it("sends the checkpoint as a conditional request and reports not-modified on 304", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(new Response(null, { status: 304, headers: { ETag: '"v1"' } }));
    const source = new UdataSource(new Set(["dados.gov.pt"]), fetcher);

    const fetched = await source.fetchDistribution(
      { baseUrl: "https://dados.gov.pt", dataset: "population" },
      { kind: "id", id: "resource-1" },
      { resource: "resource-1", validators: { default: { etag: '"v1"', lastModified: "Sat, 01 Aug 2026 12:00:00 GMT" } } },
    );

    expect(fetched).toEqual({ kind: "not-modified", validator: { etag: '"v1"' } });
    const headers = new Headers(fetcher.mock.calls[1]?.[1]?.headers);
    expect(headers.get("if-none-match")).toBe('"v1"');
    expect(headers.get("if-modified-since")).toBe("Sat, 01 Aug 2026 12:00:00 GMT");
  });

  it("rejects a distribution that is not declared by the dataset", async () => {
    const source = new UdataSource(new Set(["dados.gov.pt"]), async () => Response.json(payload));

    await expect(source.fetchDistribution({ baseUrl: "https://dados.gov.pt", dataset: "population" }, { kind: "id", id: "unknown-resource" })).rejects.toMatchObject({
      code: "invalid-config",
    });
  });

  it("reads the newest distribution of a format when no id is pinned, and refuses a dataset without one", async () => {
    const rotating = {
      ...payload,
      resources: [
        { id: "release-08", url: "https://publisher.example/2026-08.json", format: "JSON", last_modified: "2026-08-17T11:00:00+00:00" },
        { id: "release-09", url: "https://publisher.example/2026-09.json", format: "json", last_modified: "2026-09-17T11:00:15.323000+00:00" },
        { id: "notes", url: "https://publisher.example/notes.pdf", format: "pdf", last_modified: "2026-09-18T00:00:00+00:00" },
      ],
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(rotating))
      .mockResolvedValueOnce(Response.json([{ titularNipc: "500000000" }]));
    const source = new UdataSource(new Set(["dados.gov.pt"]), fetcher);

    const fetched = await source.fetchDistribution({ baseUrl: "https://dados.gov.pt", dataset: "startups" }, { kind: "format", format: "json" });
    expect(fetched).toMatchObject({ kind: "body", provenance: { sourceUrl: "https://publisher.example/2026-09.json", sourcePublishedAt: "2026-09-17T11:00:15.323Z" } });
    expect(fetcher.mock.calls[1]?.[0].toString()).toBe("https://dados.gov.pt/api/1/datasets/r/release-09");

    // Validators from the release collected last time are not sent to a newer one: its 304 would mean nothing.
    const moved = vi.fn().mockResolvedValueOnce(Response.json(rotating)).mockResolvedValueOnce(Response.json([]));
    const next = await new UdataSource(new Set(["dados.gov.pt"]), moved).fetchDistribution(
      { baseUrl: "https://dados.gov.pt", dataset: "startups" },
      { kind: "format", format: "json" },
      { resource: "release-08", validators: { default: { etag: '"august"' } } },
    );
    expect(next).toMatchObject({ kind: "body", state: { resource: "release-09" } });
    expect(new Headers(moved.mock.calls[1]?.[1]?.headers).has("if-none-match")).toBe(false);

    const empty = new UdataSource(new Set(["dados.gov.pt"]), async () => Response.json(payload));
    await expect(empty.fetchDistribution({ baseUrl: "https://dados.gov.pt", dataset: "population" }, { kind: "format", format: "json" })).rejects.toMatchObject({
      code: "invalid-config",
    });
  });

  it("validates a feed without a distributionId as reading its format's newest distribution", async () => {
    const { distributionId: _pinned, ...unpinned } = config;
    const validated = validateUdataFeedConfig(unpinned, new Set([UDATA_HOSTS]));
    expect(validated.distributionId).toBeUndefined();
    expect(validated.format).toBe("csv");
    // The resource identity no longer changes when the publisher rotates the file, so the feed keeps its checkpoint and history.
    const resolved = await resolveUdataFeed(unpinned, new Set([UDATA_HOSTS]));
    expect(resolved.resourceKey).toBe((await resolveUdataFeed({ ...unpinned, productTitle: "Renamed" }, new Set([UDATA_HOSTS]))).resourceKey);
  });

  it("rejects hosts outside its deployment allowlist", () => {
    const source = new UdataSource(new Set(["dados.gov.pt"]), fetch);

    expect(() =>
      source.validateConfig({
        baseUrl: "https://internal.example.test",
        dataset: "anything",
      }),
    ).toThrowError(GatekeeperError);
  });

  it("turns provider failures into an upstream error carrying status and Retry-After", async () => {
    const metadataDown = new UdataSource(new Set(["dados.gov.pt"]), vi.fn().mockResolvedValueOnce(new Response("unavailable", { status: 503, headers: { "Retry-After": "120" } })));
    await expect(metadataDown.fetchDistribution({ baseUrl: "https://dados.gov.pt", dataset: "population" }, { kind: "id", id: "resource-1" })).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: 120,
    });

    const distributionGone = new UdataSource(
      new Set(["dados.gov.pt"]),
      vi
        .fn()
        .mockResolvedValueOnce(Response.json(payload))
        .mockResolvedValueOnce(new Response("gone", { status: 410 })),
    );
    await expect(distributionGone.fetchDistribution({ baseUrl: "https://dados.gov.pt", dataset: "population" }, { kind: "id", id: "resource-1" })).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: undefined,
    });
  });

  it("validates every curated example and resolves its transformer", () => {
    for (const example of feedsOf("udata")) {
      const validated = validateUdataFeedConfig(libraryConfig(example.config), new Set([UDATA_HOSTS]));
      expect(validated.baseUrl, example.slug).toBe("https://dados.gov.pt");
      // A feed that names its publisher's own translator calls it from its file; every other one reads as a table.
      if (!validated.transformer) expect(() => chooseTransformer(validated), example.slug).not.toThrow();
    }
  });
});

describe("uData collection", () => {
  it("streams a distribution into header, record and completion frames", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(new Response("name,value\nLisbon,42\nPorto,\n", { headers: { ETag: '"v2"' } }));
    const result = await collect(fetcher, await request());
    expect(result.kind).toBe("batch");
    if (result.kind !== "batch") return;
    const [header, ...rest] = await frames(result.stream);
    expect(header).toMatchObject({
      type: "header",
      protocol: NORMALIZED_PROTOCOL,
      normalizer: feedNormalizer({ id: "tabular-v2", version: "5" }),
      provenance: { sourceUrl: "https://publisher.example/data.csv", sourcePublishedAt: "2026-08-24T20:14:58.444Z" },
      checkpoint: { state: { resource: "resource-1", validators: { default: { etag: '"v2"' } } } },
      products: [{ productKey: "records", suggestedSlug: "population", completeness: "complete" }],
    });
    expect(rest.filter((frame) => frame.type === "record").map((frame) => frame.value)).toEqual([
      { entityKey: expect.stringMatching(/^row-/), payload: { name: "Lisbon", value: 42 } },
      { entityKey: expect.stringMatching(/^row-/), payload: { name: "Porto", value: null } },
    ]);
    expect(rest.at(-1)).toMatchObject({
      type: "complete",
      counts: { records: 2, points: 0 },
      quality: { acceptedRecords: 2, rejectedRecords: 0 },
      products: [
        { productKey: "records", schema: { fields: [expect.objectContaining({ name: "name" }), expect.objectContaining({ name: "value", type: "number", nullable: true })] } },
      ],
    });
  });

  it("reports unchanged when the distribution answers 304 to the checkpoint validators", async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));
    const base = await request();
    const selected = chooseTransformer(config);
    const result = await collect(fetcher, {
      ...base,
      checkpoint: {
        version: 2,
        resourceKey: base.resolved.resourceKey,
        configHash: base.resolved.configHash,
        feedEpoch: base.feedEpoch,
        normalizer: feedNormalizer(selected),
        state: { resource: "resource-1", validators: { default: { etag: '"v1"' } } },
      },
    });
    expect(result).toMatchObject({ kind: "unchanged", checkpoint: { state: { resource: "resource-1", validators: { default: { etag: '"v1"' } } } } });
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("if-none-match")).toBe('"v1"');
  });

  it("leaves the distribution size to the collector's source budget instead of a buffer cap", async () => {
    const rows = Array.from({ length: 200 }, (_, index) => `place-${index},${index}`).join("\n");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(new Response(`name,value\n${rows}\n`));
    const base = await request();
    const result = await collect(fetcher, { ...base, limits: { ...base.limits, sourceBytes: 256 } });
    expect(result).toEqual({ kind: "failure", code: "response-too-large", retryable: false });
  });

  it("maps an upstream refusal to a retryable typed failure with Retry-After", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(Response.json(payload))
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "Retry-After": "30" } }));
    expect(await collect(fetcher, await request())).toEqual({
      kind: "failure",
      code: "upstream-error",
      retryable: true,
      retryAfterSeconds: 30,
    });
  });
});
