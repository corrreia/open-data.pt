import { describe, expect, it, vi } from "vitest";
import {
  GatekeeperError,
  NORMALIZED_PROTOCOL,
  collectNormalized,
  type CollectionRequest,
  type CollectionResult,
  type JsonObject,
  type SourceFetch,
} from "@open-data-pt/gatekeeper-shared";
import { CKAN_LIMITS, CkanSource } from "../packages/gatekeeper-shared/src/formats/ckan/ckan";
import { ckanCollector } from "../packages/gatekeeper-shared/src/formats/ckan";

const RESOURCE_ID = "418c7837-95ee-4943-be22-3d9d09e5b4e9";
const RESOURCE_URL =
  "https://opendata.porto.digital/dataset/example/resource/418c7837-95ee-4943-be22-3d9d09e5b4e9/download/data.csv";
const LAST_MODIFIED = "2026-03-18T03:25:30.243935";
const SYNTHETIC_ETAG = `"ckan:5:${RESOURCE_ID}:2026-03-18T03:25:30.243Z"`;

function packageResponse(overrides: JsonObject = {}, packageOverrides: JsonObject = {}): Response {
  return Response.json({
    success: true,
    result: {
      name: "parques-de-estacionamento-municipais",
      title: "Parques de estacionamento municipais",
      metadata_modified: "2026-09-07T17:00:17.651124",
      ...packageOverrides,
      resources: [
        {
          id: RESOURCE_ID,
          name: "Parking CSV",
          format: "CSV",
          url: RESOURCE_URL,
          last_modified: LAST_MODIFIED,
          datastore_active: false,
          ...overrides,
        },
      ],
    },
  });
}

const CKAN_HOSTS = "opendata.porto.digital";

function source(fetcher: typeof fetch): CkanSource {
  return new CkanSource(new Set([CKAN_HOSTS]), fetcher);
}

const config = {
  host: "opendata.porto.digital",
  dataset: "parques-de-estacionamento-municipais",
  resource: RESOURCE_ID,
};

async function bodyText(fetch: SourceFetch): Promise<string> {
  if (fetch.kind !== "body") throw new Error(`Expected a source body, got ${fetch.kind}`);
  return new Response(fetch.body).text();
}

/** A DataStore of `total` records `{ _id: n }`, served page by page as CKAN would. */
function datastoreFetcher(total: number, pageTotal: (offset: number) => number = () => total) {
  return vi.fn<typeof fetch>(async (input) => {
    const url = new URL(input.toString());
    if (url.pathname.endsWith("/package_show")) return packageResponse({ datastore_active: true });
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const records = Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, (_, index) => ({ _id: offset + index + 1 }));
    return Response.json({
      success: true,
      result: { fields: [{ id: "_id", type: "int" }], records, total: limit === 0 ? total : pageTotal(offset) },
    });
  });
}

describe("CKAN Gatekeeper", () => {
  it("normalizes valid configuration and rejects malformed values", () => {
    const ckan = source(fetch);
    expect(
      ckan.validateConfig({
        host: " OPENDATA.PORTO.DIGITAL ",
        dataset: "parques-de-estacionamento-municipais",
        resource: RESOURCE_ID.toUpperCase(),
      }),
    ).toEqual(config);
    expect(() =>
      ckan.validateConfig({ host: "opendata.porto.digital", dataset: "Bad Dataset" }),
    ).toThrow("dataset must match");
    expect(() =>
      ckan.validateConfig({ ...config, resource: "not-a-uuid" }),
    ).toThrow("resource must be a UUID");
  });

  it("rejects hosts outside the deployment allowlist", () => {
    expect(() =>
      source(fetch).validateConfig({
        host: "internal.example",
        dataset: "anything",
      }),
    ).toThrowError(GatekeeperError);
  });

  it("collects a declared resource with provenance, completeness and checkpoint validators", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(packageResponse())
      .mockImplementationOnce(async (input, init) => {
        expect(input.toString()).toBe(RESOURCE_URL);
        const headers = new Headers(init?.headers);
        expect(headers.get("if-none-match")).toBe('"previous"');
        expect(headers.get("if-modified-since")).toBe(
          "Tue, 17 Mar 2026 03:25:30 GMT",
        );
        return new Response("id,name\n1,Aliados\n", {
          headers: { "Content-Type": "text/csv" },
        });
      });

    const collected = await source(fetcher).collect(config, {
      etag: '"previous"',
      lastModified: "Tue, 17 Mar 2026 03:25:30 GMT",
    });

    expect(collected.fetch).toMatchObject({
      kind: "body",
      provenance: { sourceUrl: RESOURCE_URL, sourcePublishedAt: "2026-03-18T03:25:30.243Z" },
      completeness: "complete",
      validator: { etag: SYNTHETIC_ETAG, lastModified: "Wed, 18 Mar 2026 03:25:30 GMT" },
    });
    expect(collected.metadata).toMatchObject({
      package: { name: "parques-de-estacionamento-municipais" },
      resource: { id: RESOURCE_ID },
      source: { kind: "file", format: "csv" },
    });
    expect(collected.metadata?.package).not.toHaveProperty("resources");
    expect(await bodyText(collected.fetch)).toBe("id,name\n1,Aliados\n");
    expect(fetcher.mock.calls[0]?.[0].toString()).toBe(
      "https://opendata.porto.digital/api/3/action/package_show?id=parques-de-estacionamento-municipais",
    );
  });

  it("hands the publisher's body over as a stream instead of buffering it", async () => {
    const upstream = new Response("id,name\n1,Aliados\n");
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(packageResponse()).mockResolvedValueOnce(upstream);
    const collected = await source(fetcher).collect(config);
    expect(collected.fetch.kind === "body" && collected.fetch.body).toBe(upstream.body);
  });

  it("falls back to the publisher's validators when the catalogue has no timestamp", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(packageResponse({ last_modified: null }, { metadata_modified: null }))
      .mockResolvedValueOnce(new Response("id\n1\n", { headers: { ETag: '"file-v2"' } }));
    const collected = await source(fetcher).collect(config);
    expect(collected.fetch).toMatchObject({ kind: "body", validator: { etag: '"file-v2"' } });
    expect(collected.fetch.kind === "body" && collected.fetch.provenance).toEqual({ sourceUrl: RESOURCE_URL });
  });

  it("reports not-modified when package metadata matches the synthetic checkpoint", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(packageResponse());
    const collected = await source(fetcher).collect(config, { etag: SYNTHETIC_ETAG });

    expect(collected).toEqual({
      fetch: {
        kind: "not-modified",
        validator: { etag: SYNTHETIC_ETAG, lastModified: "Wed, 18 Mar 2026 03:25:30 GMT" },
      },
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("passes a provider 304 through after forwarding checkpoint headers", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(packageResponse({ last_modified: "2026-03-19T00:00:00Z" }))
      .mockResolvedValueOnce(new Response(null, { status: 304 }));

    const collected = await source(fetcher).collect(config, {
      etag: '"provider-v1"',
    });

    expect(collected.fetch.kind).toBe("not-modified");
    expect(collected.metadata).toBeUndefined();
    expect(new Headers(fetcher.mock.calls[1]?.[1]?.headers).get("if-none-match")).toBe(
      '"provider-v1"',
    );
  });

  it("falls back to the declared file when CKAN has a stale DataStore flag", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(packageResponse({ datastore_active: true }))
      .mockResolvedValueOnce(
        Response.json(
          {
            success: false,
            error: {
              __type: "Not Found Error",
              message: `Resource ${RESOURCE_ID} was not found.`,
            },
          },
          { status: 404 },
        ),
      )
      .mockResolvedValueOnce(new Response("id,name\n1,Aliados\n"));

    const collected = await source(fetcher).collect(config);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(collected.metadata?.source).toEqual({ kind: "file", format: "csv" });
    expect(await bodyText(collected.fetch)).toBe("id,name\n1,Aliados\n");
  });

  it("refuses redirects instead of following them beyond the allowlist", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { Location: "https://files.attacker.example/package.json" },
      }),
    );

    await expect(source(fetcher).collect(config)).rejects.toMatchObject({
      code: "source-denied",
    });
    expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
  });

  it("rejects a package resource URL outside the allowlist", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        packageResponse({ url: "https://files.attacker.example/data.csv" }),
      );

    await expect(source(fetcher).collect(config)).rejects.toMatchObject({
      code: "source-denied",
    });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("reports provider errors with their status and Retry-After, without their body", async () => {
    const unavailable = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("maintenance", { status: 503, headers: { "Retry-After": "120" } }));
    await expect(source(unavailable).collect(config)).rejects.toMatchObject({
      code: "upstream-error",
      retryAfterSeconds: 120,
      message: "CKAN package_show returned HTTP 503",
    });

    const broken = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(packageResponse())
      .mockResolvedValueOnce(new Response("oops", { status: 500, headers: { "Retry-After": "soon" } }));
    const error = await source(broken).collect(config).catch((caught: Error) => caught);
    expect(error).toMatchObject({ code: "upstream-error", message: "CKAN resource download returned HTTP 500" });
    expect(error).toHaveProperty("retryAfterSeconds", undefined);
  });

  it("streams DataStore records page by page after reading fields and total up front", async () => {
    const fetcher = datastoreFetcher(CKAN_LIMITS.datastorePageRows + 2);
    const collected = await source(fetcher).collect(config);

    expect(collected.metadata?.source).toEqual({ kind: "datastore", fields: [{ id: "_id", type: "int" }] });
    expect(collected.fetch).toMatchObject({ kind: "body", completeness: "complete" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0].toString()).toContain(`/api/3/action/datastore_search?resource_id=${RESOURCE_ID}&limit=0`);

    const lines = (await bodyText(collected.fetch)).trim().split("\n");
    expect(lines).toHaveLength(CKAN_LIMITS.datastorePageRows + 2);
    expect(lines[0]).toBe('{"_id":1}');
    expect(fetcher).toHaveBeenCalledTimes(4);
    expect(fetcher.mock.calls[3]?.[0].toString()).toContain(`limit=2&offset=${CKAN_LIMITS.datastorePageRows}`);
  });

  it("decides a partial snapshot before streaming when the table exceeds the request budget", async () => {
    const budget = CKAN_LIMITS.datastorePageRows * CKAN_LIMITS.datastorePages;
    const fetcher = datastoreFetcher(budget + 1);
    const collected = await source(fetcher).collect(config);

    expect(collected.fetch).toMatchObject({ kind: "body", completeness: "partial" });
    const lines = (await bodyText(collected.fetch)).trim().split("\n");
    expect(lines).toHaveLength(budget);
    expect(fetcher).toHaveBeenCalledTimes(CKAN_LIMITS.datastorePages + 2);
    // 100 pages of 1,000 rows: near the 5 s default when the whole suite shares the CPU.
  }, 30_000);

  it("fails the stream when the DataStore total changes during pagination", async () => {
    const total = CKAN_LIMITS.datastorePageRows + 1;
    const collected = await source(datastoreFetcher(total, (offset) => (offset === 0 ? total : total + 1))).collect(config);
    await expect(bodyText(collected.fetch)).rejects.toMatchObject({
      code: "invalid-response",
      message: "datastore_search changed total during pagination",
    });
  });
});

describe("CKAN collection through the shared collector", () => {
  async function collect(fetcher: typeof fetch, checkpointEtag?: string): Promise<CollectionResult> {
    const collector = ckanCollector({ config, hosts: CKAN_HOSTS, fetcher });
    const resolved = await collector.resolve(config);
    const request: CollectionRequest = {
      protocol: NORMALIZED_PROTOCOL,
      collectionId: "collection_1",
      feed: { id: "feed_1", slug: "porto-municipal-parking-feed", title: "Porto parking", description: "Car parks" },
      resolved,
      feedEpoch: "epoch-1",
      mode: { kind: "live" },
      limits: { sourceBytes: 1024 * 1024, outputBytes: 4 * 1024 * 1024, frameBytes: 256 * 1024, recordBytes: 128 * 1024, records: 10_000, products: 4 },
      deadline: new Date(Date.now() + 30_000).toISOString(),
      observedAt: "2026-09-10T12:00:00.000Z",
    };
    if (checkpointEtag) {
      request.checkpoint = {
        version: 2,
        resourceKey: resolved.resourceKey,
        configHash: resolved.configHash,
        feedEpoch: "epoch-1",
        normalizer: { id: "ckan-resource", version: "5" },
        state: { validators: { default: { etag: checkpointEtag } } },
      };
    }
    return collectNormalized(request, collector);
  }

  it("reports an unchanged resource with its refreshed checkpoint", async () => {
    const result = await collect(vi.fn<typeof fetch>().mockResolvedValueOnce(packageResponse()), SYNTHETIC_ETAG);
    expect(result).toMatchObject({
      kind: "unchanged",
      checkpoint: { state: { validators: { default: { etag: SYNTHETIC_ETAG } } } },
    });
  });

  it("maps an upstream failure to a retryable failure that keeps Retry-After", async () => {
    const result = await collect(vi.fn<typeof fetch>().mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "Retry-After": "30" } })));
    expect(result).toEqual({ kind: "failure", code: "upstream-error", retryable: true, retryAfterSeconds: 30 });
  });
});
