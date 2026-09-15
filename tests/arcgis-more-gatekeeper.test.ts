import { jsonAs } from "./support";
import { describe, expect, it, vi } from "vitest";
import {
  GatekeeperError,
  type JsonObject,
  type JsonValue,
  type SourceBody,
  type SourceFetch,
} from "@open-data-pt/gatekeeper-shared";
import {
  collectArcgisFeed,
  validateArcgisFeedConfig,
  type Fetcher,
} from "../packages/gatekeeper-shared/src/formats/arcgis";

const apaHost = "sniambgeoogc.apambiente.pt";
const hosts = new Set(["services.arcgis.com", apaHost]);
const config = {
  host: apaHost,
  service: "getogc/rest/services/SNIAmb/Praias/MapServer",
  layer: "0",
};
const layerUrl = `https://${apaHost}/${config.service}/0`;

function metadata(overrides: JsonObject = {}) {
  return {
    name: "Praia",
    geometryType: "esriGeometryPoint",
    maxRecordCount: 2,
    supportedQueryFormats: "JSON, AMF, geoJSON",
    advancedQueryCapabilities: { supportsPagination: true },
    description: "Portuguese bathing beaches",
    copyrightText: "APA",
    fields: [
      {
        name: "objectid",
        alias: "objectid",
        type: "esriFieldTypeOID",
        nullable: false,
      },
      {
        name: "nome_praia",
        alias: "nome praia",
        type: "esriFieldTypeString",
        nullable: true,
      },
    ],
    ...overrides,
  };
}

function geojsonPage(ids: number[], exceededTransferLimit = false) {
  return {
    type: "FeatureCollection",
    exceededTransferLimit,
    features: ids.map((id) => ({
      type: "Feature",
      properties: { objectid: id, nome_praia: `Beach ${id}` },
      geometry: { type: "Point", coordinates: [-9 - id / 100, 38 + id / 100] },
    })),
  };
}

function fixtureFetcher(layerMetadata: JsonObject, page: JsonValue | undefined, count = 1): Fetcher {
  return async (input) => {
    const url = new URL(input.toString());
    if (!url.pathname.endsWith("/query")) return Response.json(layerMetadata);
    if (url.searchParams.get("returnCountOnly") === "true") return Response.json({ count });
    return Response.json(page);
  };
}

/** Metadata without offset paging, the listed object IDs, and one GeoJSON page per ID batch. */
function objectIdFetcher(objectIds: number[], pageFor: (ids: number[]) => JsonValue = (ids) => geojsonPage(ids)) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input.toString());
    if (!url.pathname.endsWith("/query")) {
      return Response.json(metadata({ advancedQueryCapabilities: { supportsPagination: false } }));
    }
    if (url.searchParams.get("returnIdsOnly") === "true") {
      return Response.json({ objectIdFieldName: "objectid", objectIds });
    }
    return Response.json(pageFor((url.searchParams.get("objectIds") ?? "").split(",").filter(Boolean).map(Number)));
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

describe("ArcGIS Gatekeeper — APA SNIAmb", () => {
  it("normalizes the allowlisted APA MapServer and rejects other hosts", () => {
    expect(validateArcgisFeedConfig({
      layerUrl: `${layerUrl}`,
    }, hosts)).toEqual(config);

    expect(() => validateArcgisFeedConfig({
      layerUrl: "https://example.test/getogc/rest/services/SNIAmb/Praias/MapServer/0",
    }, hosts)).toThrowError(GatekeeperError);
  });

  it("collects a layer without editingInfo with provenance, no validator and cleared state", async () => {
    const fetcher = vi.fn(fixtureFetcher(metadata(), geojsonPage([1])));
    const fetched = bodyOf(await collectArcgisFeed(config, undefined, hosts, fetcher));

    expect(fetched.provenance).toEqual({ sourceUrl: layerUrl });
    expect(fetched.completeness).toBe("complete");
    expect(fetched.validator).toBeUndefined();
    expect(fetched.state).toEqual({});
    await readText(fetched.body);
    expect(fetcher.mock.calls[2]?.[0].toString()).toContain("f=geojson&outSR=4326");
  });

  it("collects again when a layer without editingInfo was collected before", async () => {
    const fetcher = vi.fn(fixtureFetcher(metadata(), geojsonPage([1, 2]), 2));
    const fetched = await collectArcgisFeed(config, { etag: '"sha256-stale"' }, hosts, fetcher);

    expect(fetched).toMatchObject({ kind: "body", state: {} });
    expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).get("if-none-match")).toBe('"sha256-stale"');
  });

  it("uses sorted object ID pages, fetched only as features are read, when offset pagination is unsupported", async () => {
    const fetcher = objectIdFetcher([3, 1, 2]);
    const fetched = bodyOf(await collectArcgisFeed(config, undefined, hosts, fetcher));

    expect(fetched.completeness).toBe("complete");
    expect(fetcher).toHaveBeenCalledTimes(2);
    const artifact = jsonAs<{
      features: Array<{ properties: { objectid: number } }>;
    }>(await readText(fetched.body));

    expect(artifact.features.map((feature) => feature.properties.objectid)).toEqual([1, 2, 3]);
    expect(fetcher.mock.calls.map((call) => call[0].toString())).toEqual([
      `${layerUrl}?f=json`,
      `${layerUrl}/query?where=1%3D1&returnIdsOnly=true&f=json`,
      `${layerUrl}/query?objectIds=1%2C2&outFields=*&f=geojson&outSR=4326&orderByFields=objectid`,
      `${layerUrl}/query?objectIds=3&outFields=*&f=geojson&outSR=4326&orderByFields=objectid`,
    ]);
  });

  it("declares a layer partial when its object IDs exceed the page cap", async () => {
    const fetcher = objectIdFetcher(Array.from({ length: 201 }, (_, index) => index + 1));
    const fetched = bodyOf(await collectArcgisFeed(config, undefined, hosts, fetcher));
    expect(fetched.completeness).toBe("partial");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("fails the stream when an object ID page is truncated after completeness was declared", async () => {
    const fetched = bodyOf(await collectArcgisFeed(config, undefined, hosts, objectIdFetcher([1, 2], (ids) => geojsonPage(ids, true))));
    await expect(readText(fetched.body)).rejects.toMatchObject({ code: "invalid-response" });
  });

  it.each([
    {
      geometryType: "esriGeometryPoint",
      geometry: { x: -9.14, y: 38.72 },
      expected: { type: "Point", coordinates: [-9.14, 38.72] },
    },
    {
      geometryType: "esriGeometryPolyline",
      geometry: { paths: [[[-9.2, 38.7], [-9.1, 38.8]]] },
      expected: { type: "LineString", coordinates: [[-9.2, 38.7], [-9.1, 38.8]] },
    },
    {
      geometryType: "esriGeometryPolygon",
      geometry: { rings: [[[-9.2, 38.7], [-9.2, 38.8], [-9.1, 38.8], [-9.1, 38.7], [-9.2, 38.7]]] },
      expected: { type: "Polygon" },
    },
  ])("converts $geometryType Esri JSON to GeoJSON", async ({ geometryType, geometry, expected }) => {
    const fetched = bodyOf(await collectArcgisFeed(
      config,
      undefined,
      hosts,
      fixtureFetcher(
        metadata({ geometryType, supportedQueryFormats: "JSON" }),
        {
          geometryType,
          spatialReference: { wkid: 4326 },
          features: [{ attributes: { objectid: 1, nome_praia: "Feature" }, geometry }],
        },
      ),
    ));
    const artifact = jsonAs<{
      features: Array<{ geometry: JsonObject; properties: JsonObject }>;
    }>(await readText(fetched.body));

    expect(artifact.features[0]?.geometry).toMatchObject(expected);
    expect(artifact.features[0]?.properties).toEqual({ objectid: 1, nome_praia: "Feature" });
  });

  it("rejects an Esri JSON page that ignored outSR=4326", async () => {
    const fetched = bodyOf(await collectArcgisFeed(config, undefined, hosts, fixtureFetcher(
      metadata({ supportedQueryFormats: "JSON" }),
      { spatialReference: { wkid: 3763 }, features: [{ attributes: { objectid: 1 }, geometry: { x: 1, y: 2 } }] },
    )));
    await expect(readText(fetched.body)).rejects.toThrow("spatial reference 3763");
  });

  it("turns an ArcGIS error envelope or malformed feature on a query page into typed failures", async () => {
    const failed = bodyOf(await collectArcgisFeed(config, undefined, hosts, fixtureFetcher(metadata(), { error: { code: 400, message: "Invalid query" } })));
    await expect(readText(failed.body)).rejects.toMatchObject({ code: "upstream-error" });

    const malformed = bodyOf(await collectArcgisFeed(config, undefined, hosts, fixtureFetcher(metadata(), { type: "FeatureCollection", features: [{ type: "Point" }] })));
    await expect(readText(malformed.body)).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("reports a throttled query page with its status and Retry-After", async () => {
    const fetched = bodyOf(await collectArcgisFeed(config, undefined, hosts, async (input) => {
      const url = new URL(input.toString());
      if (!url.pathname.endsWith("/query")) return Response.json(metadata());
      if (url.searchParams.get("returnCountOnly") === "true") return Response.json({ count: 1 });
      return new Response("slow down", { status: 429, headers: { "Retry-After": "30" } });
    }));
    await expect(readText(fetched.body)).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 30 });
  });

  it("reports provider errors before querying the layer", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));

    await expect(
      collectArcgisFeed(config, undefined, hosts, fetcher),
    ).rejects.toMatchObject({ code: "upstream-error" });
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
