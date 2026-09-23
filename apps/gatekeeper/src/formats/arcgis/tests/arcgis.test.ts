import { jsonAs } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import {
  GatekeeperError,
  NORMALIZED_PROTOCOL,
  collectNormalized,
  isJsonObject,
  parseJson,
  type CollectionRequest,
  type JsonObject,
  type JsonValue,
  type SourceBody,
  type SourceFetch,
  feedCollector,
  libraryConfig,
  resolveLibraryFeed,
} from "#/index";
import { RUNNABLE } from "#/catalog/index";
import { MAX_METADATA_BYTES, collectArcgisFeed, validateArcgisFeedConfig } from "#/formats/arcgis/index";
import { carriedLibraries, feedsOf } from "#/tests/catalog";

const hosts = new Set(["services.arcgis.com"]);
const config = {
  host: "services.arcgis.com",
  service: "account/arcgis/rest/services/Useful_Layer/FeatureServer",
  layer: "0",
};
const layerUrl = "https://services.arcgis.com/account/arcgis/rest/services/Useful_Layer/FeatureServer/0";
const revision = { etag: 'W/"1788509530839"', lastModified: "Fri, 04 Sep 2026 08:12:10 GMT" };
const newLisbonExamples = feedsOf("arcgis").filter((example) => example.slug.startsWith("lisbon-"));

const metadata = {
  name: "Useful layer",
  type: "Feature Layer",
  geometryType: "esriGeometryPoint",
  objectIdField: "OBJECTID",
  globalIdField: "GlobalID",
  maxRecordCount: 2,
  supportedQueryFormats: "JSON, geoJSON",
  description: "A useful layer.",
  copyrightText: "City",
  editingInfo: { lastEditDate: 1_788_509_530_839 },
  fields: [
    {
      name: "OBJECTID",
      alias: "Object ID",
      type: "esriFieldTypeOID",
      nullable: false,
    },
    {
      name: "GlobalID",
      alias: "Global ID",
      type: "esriFieldTypeGlobalID",
      nullable: false,
    },
  ],
};

/** A Lisboa layer's feed, run on the test's layer: every ArcGIS feed's functions are the same, only its configuration differs. */
function layerCollector(fetcher: typeof fetch) {
  const feed = RUNNABLE.get("lisbon-parishes-feed");
  if (!feed) throw new Error("No feed file defines lisbon-parishes-feed");
  return feedCollector(feed, { ...config, source: "arcgis" }, carriedLibraries("arcgis"), { fetcher });
}

/** A GeoJSON page of consecutive object IDs; the transfer flag sits where some servers put it. */
function page(first: number, count: number, exceededTransferLimit: boolean): JsonObject {
  return {
    type: "FeatureCollection",
    properties: { exceededTransferLimit },
    features: Array.from({ length: count }, (_, index) => ({
      type: "Feature",
      id: first + index,
      properties: { OBJECTID: first + index, GlobalID: `global-${first + index}` },
      geometry: { type: "Point", coordinates: [-9.14, 38.72] },
    })),
  };
}

/** Metadata, the count query, and offset pages of two, the last page ending the layer. */
function layerFetcher(count: number, pageFor: (offset: number) => JsonValue = (offset) => page(offset + 1, Math.min(2, count - offset), offset + 2 < count)) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input.toString());
    if (!url.pathname.endsWith("/query")) return Response.json(metadata);
    if (url.searchParams.get("returnCountOnly") === "true") return Response.json({ count });
    return Response.json(pageFor(Number(url.searchParams.get("resultOffset"))));
  });
}

function bodyOf(fetched: SourceFetch): SourceBody {
  if (fetched.kind !== "body") throw new Error(`Expected a source body, got ${fetched.kind}`);
  return fetched;
}

async function readText(body: ReadableStream<Uint8Array> | Uint8Array): Promise<string> {
  if (body instanceof Uint8Array) return new TextDecoder().decode(body);
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const part = await reader.read();
    if (part.done) return text + decoder.decode();
    text += decoder.decode(part.value, { stream: true });
  }
}

interface Artifact {
  type: string;
  arcgis: { name: string };
  features: Array<{ properties: { OBJECTID: number } }>;
}

async function request(overrides: Partial<CollectionRequest> = {}): Promise<CollectionRequest> {
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: "collection_1",
    feed: { id: "feed_1", slug: "useful-layer-feed", title: "Useful layer", description: "test feed" },
    resolved: await resolveLibraryFeed({ ...config, source: "arcgis" }, carriedLibraries("arcgis")),
    feedEpoch: "epoch-1",
    mode: { kind: "live" },
    limits: { sourceBytes: 1_048_576, outputBytes: 1_048_576, frameBytes: 65_536, recordBytes: 65_536, records: 100, products: 4 },
    deadline: new Date(Date.now() + 10_000).toISOString(),
    observedAt: "2026-09-10T10:00:00.000Z",
    ...overrides,
  };
}

async function frames(stream: ReadableStream<Uint8Array>): Promise<JsonObject[]> {
  return (await readText(stream))
    .trim()
    .split("\n")
    .map((line) => {
      const frame = parseJson(line);
      if (!isJsonObject(frame)) throw new Error("Every frame is a JSON object");
      return frame;
    });
}

describe("ArcGIS Gatekeeper", () => {
  it("normalizes structured and layerUrl configurations", () => {
    expect(validateArcgisFeedConfig(config, hosts)).toEqual(config);
    expect(validateArcgisFeedConfig({ layerUrl }, hosts)).toEqual(config);
  });

  it.each(newLisbonExamples)("validates the curated $slug example", (example) => {
    const config = libraryConfig(example.config);
    expect(validateArcgisFeedConfig(config, hosts)).toEqual(config);
  });

  it("ships every newly curated Lisbon layer", () => {
    expect(newLisbonExamples).toHaveLength(24);
    const permits = newLisbonExamples.find((example) => example.slug === "lisbon-building-permits-feed");
    expect(permits?.policy.collection.maxBytes).toBe(24 * 1024 * 1024);
    expect(
      newLisbonExamples.every((example) => (example === permits || example.policy.collection.maxBytes === 5 * 1024 * 1024) && example.policy.collection.historyMode === "changes"),
    ).toBe(true);
  });

  it("rejects denied hosts and unsafe service paths", () => {
    expect(() =>
      validateArcgisFeedConfig(
        {
          layerUrl: "https://internal.example.test/account/arcgis/rest/services/Layer/FeatureServer/0",
        },
        hosts,
      ),
    ).toThrowError(GatekeeperError);
    expect(() =>
      validateArcgisFeedConfig(
        {
          host: "services.arcgis.com",
          service: "../private/FeatureServer",
          layer: "0",
        },
        hosts,
      ),
    ).toThrow("unsafe path segment");
  });

  it("streams offset pages lazily into one GeoJSON document with typed provenance", async () => {
    const fetcher = layerFetcher(3);
    const fetched = bodyOf(await collectArcgisFeed(config, undefined, hosts, fetcher));

    expect(fetched).toMatchObject({
      provenance: { sourceUrl: layerUrl, sourcePublishedAt: "2026-09-04T08:12:10.839Z" },
      completeness: "complete",
      validator: revision,
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(fetcher.mock.calls[1]?.[0].toString()).toBe(`${layerUrl}/query?where=1%3D1&returnCountOnly=true&f=json`);

    const artifact = jsonAs<Artifact>(await readText(fetched.body));
    expect(artifact).toMatchObject({ type: "FeatureCollection", arcgis: { name: "Useful layer" } });
    expect(artifact.features.map((feature) => feature.properties.OBJECTID)).toEqual([1, 2, 3]);
    expect(fetcher.mock.calls.slice(2).map((call) => call[0].toString())).toEqual([
      `${layerUrl}/query?where=1%3D1&outFields=*&f=geojson&outSR=4326&resultOffset=0&resultRecordCount=2&orderByFields=OBJECTID`,
      `${layerUrl}/query?where=1%3D1&outFields=*&f=geojson&outSR=4326&resultOffset=2&resultRecordCount=2&orderByFields=OBJECTID`,
    ]);
  });

  it("answers a request on another protocol release with a passing failure, not a permanent one", async () => {
    // During a deploy the kernel and this Gatekeeper differ for a minute; a permanent failure would cool the feed down for hours.
    // SAFETY: an older release's protocol string is exactly what this test needs to send through the typed request.
    const result = await collectNormalized(await request({ protocol: "open-data-normalized/3" as typeof NORMALIZED_PROTOCOL }), layerCollector(layerFetcher(3)));
    expect(result).toEqual({ kind: "failure", code: "protocol-mismatch", retryable: true, retryAfterSeconds: 60 });
  });

  it("declares a layer beyond the page cap partial before reading any page", async () => {
    const fetcher = layerFetcher(201, (offset) => page(offset + 1, 2, true));
    const fetched = bodyOf(await collectArcgisFeed(config, undefined, hosts, fetcher));

    expect(fetched.completeness).toBe("partial");
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(jsonAs<Artifact>(await readText(fetched.body)).features).toHaveLength(200);
  });

  it("fails the stream when a layer declared complete outgrows the page cap while paging", async () => {
    const fetched = bodyOf(
      await collectArcgisFeed(
        config,
        undefined,
        hosts,
        layerFetcher(3, (offset) => page(offset + 1, 2, true)),
      ),
    );

    expect(fetched.completeness).toBe("complete");
    await expect(readText(fetched.body)).rejects.toMatchObject({ code: "upstream-error" });
  });

  it("reports not-modified when the metadata revision equals the checkpoint", async () => {
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get("if-none-match")).toBe(revision.etag);
      expect(headers.get("if-modified-since")).toBe(revision.lastModified);
      return Response.json(metadata);
    });

    expect(await collectArcgisFeed(config, revision, hosts, fetcher)).toEqual({ kind: "not-modified", validator: revision });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("passes an upstream 304 through with its validators", async () => {
    const fetcher = vi.fn(async () => new Response(null, { status: 304, headers: { ETag: 'W/"1"' } }));
    expect(await collectArcgisFeed(config, { etag: 'W/"1"' }, hosts, fetcher)).toEqual({ kind: "not-modified", validator: { etag: 'W/"1"' } });
  });

  it("enforces the metadata byte cap before buffering", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("{}", {
          headers: { "Content-Length": String(MAX_METADATA_BYTES + 1) },
        }),
    );

    await expect(collectArcgisFeed(config, undefined, hosts, fetcher)).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("reports provider failures with their status and Retry-After without attempting a query", async () => {
    const fetcher = vi.fn(async () => new Response("temporarily unavailable", { status: 503, headers: { "Retry-After": "120" } }));

    await expect(collectArcgisFeed(config, undefined, hosts, fetcher)).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 120 });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});

describe("ArcGIS collection through the shared collector", () => {
  it("streams header, records and a finalized schema from the paged layer", async () => {
    const req = await request();
    const result = await collectNormalized(req, layerCollector(layerFetcher(3)));
    if (result.kind !== "batch") throw new Error(`Expected a batch, got ${JSON.stringify(result)}`);
    const [header, ...rest] = await frames(result.stream);
    const complete = rest.at(-1);

    expect(header).toMatchObject({
      type: "header",
      normalizer: { id: "arcgis-rest-layer", version: "2" },
      provenance: { sourceUrl: layerUrl, sourcePublishedAt: "2026-09-04T08:12:10.839Z" },
      products: [{ productKey: "features", suggestedSlug: "useful-layer", kind: "record", completeness: "complete" }],
      checkpoint: { state: { validators: { default: revision } } },
    });
    expect(rest.slice(0, -1)).toEqual(
      [1, 2, 3].map((id) =>
        expect.objectContaining({
          type: "record",
          productKey: "features",
          value: expect.objectContaining({ entityKey: `global-${id}` }),
        }),
      ),
    );
    expect(complete).toMatchObject({
      type: "complete",
      counts: { records: 3, points: 0 },
      quality: { acceptedRecords: 3, rejectedRecords: 0 },
      products: [{ productKey: "features", schema: { fields: expect.arrayContaining([expect.objectContaining({ id: "GlobalID", type: "identifier", nullable: false })]) } }],
    });
  });

  it("reports an unchanged layer from the checkpoint's revision", async () => {
    const req = await request();
    const unchanged = await collectNormalized(
      {
        ...req,
        checkpoint: {
          version: 2,
          resourceKey: req.resolved.resourceKey,
          configHash: req.resolved.configHash,
          feedEpoch: req.feedEpoch,
          normalizer: { id: "arcgis-rest-layer", version: "2" },
          state: { validators: { default: { etag: revision.etag } } },
        },
      },
      layerCollector(layerFetcher(3)),
    );
    expect(unchanged).toMatchObject({ kind: "unchanged", checkpoint: { state: { validators: { default: revision } } } });
  });

  it("fails when the streamed layer exceeds the source byte budget", async () => {
    const result = await collectNormalized(
      await request({ limits: { sourceBytes: 64, outputBytes: 1_048_576, frameBytes: 65_536, recordBytes: 65_536, records: 100, products: 4 } }),
      layerCollector(layerFetcher(3)),
    );
    expect(result).toEqual({ kind: "failure", code: "response-too-large", retryable: false });
  });
});
