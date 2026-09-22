import type { JsonValue } from "@open-data-pt/contract";
import { describe, expect, it, vi } from "vitest";
import { collectIpmaFeed, IPMA_FEED_LIMITS, validateIpmaFeedConfig } from "../apps/gatekeeper/src/sources/ipma/ipma";

const ORIGIN = "https://api.ipma.pt";

function jsonResponse(value: JsonValue | undefined, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}

describe("IPMA Gatekeeper", () => {
  it("validates and normalizes supported feed configurations", () => {
    expect(validateIpmaFeedConfig({ feed: "station-observations" })).toEqual({ feed: "station-observations" });
    expect(validateIpmaFeedConfig({ feed: "daily-forecast" })).toEqual({ feed: "daily-forecast" });
    expect(validateIpmaFeedConfig({ feed: "seismic" })).toEqual({ feed: "seismic" });
    expect(() => validateIpmaFeedConfig({ feed: "unknown" })).toThrow("IPMA feeds require feed=");
  });

  it("rejects caller-provided hosts and a misconfigured Worker origin", async () => {
    expect(() => validateIpmaFeedConfig({ feed: "seismic", host: "evil.example" })).toThrow("does not accept host");
    await expect(collectIpmaFeed({ feed: "seismic" }, undefined, "https://evil.example", vi.fn())).rejects.toThrow("origin is not allowed");
  });

  it("combines source documents with provenance, completeness and the primary validator", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = input.toString();
      if (url.endsWith("observations.json")) {
        return jsonResponse(
          { "2026-09-07T16:00": {} },
          {
            ETag: '"observations-v1"',
            "Last-Modified": "Mon, 07 Sep 2026 16:35:03 GMT",
          },
        );
      }
      if (url.endsWith("stations.json")) return jsonResponse([]);
      throw new Error(`Unexpected URL ${url}`);
    });

    const fetched = await collectIpmaFeed({ feed: "station-observations" }, undefined, ORIGIN, fetcher);

    expect(fetched).toMatchObject({
      kind: "body",
      completeness: "complete",
      provenance: {
        sourceUrl: "https://api.ipma.pt/open-data/observation/meteorology/stations/observations.json",
        sourcePublishedAt: "2026-09-07T16:35:03.000Z",
      },
      validator: { etag: '"observations-v1"', lastModified: "Mon, 07 Sep 2026 16:35:03 GMT" },
    });
    if (fetched.kind !== "body") throw new Error("expected a source body");
    expect(await new Response(fetched.body).json()).toEqual({ stations: [], observations: { "2026-09-07T16:00": {} } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("reports the primary resource as not modified with its validator", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response(null, {
          status: 304,
          headers: { ETag: '"mainland-v1"' },
        }),
    );

    const fetched = await collectIpmaFeed({ feed: "seismic" }, undefined, ORIGIN, fetcher);

    expect(fetched).toEqual({ kind: "not-modified", validator: { etag: '"mainland-v1"' } });
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("does not let one validator hide a changed component of a compound feed", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
      const azores = input.toString().endsWith("/3.json");
      return jsonResponse({ data: azores ? [{ id: "azores-new" }] : [], updateDate: "2026-09-07T16:36:02Z" }, azores ? {} : { ETag: '"mainland-v1"' });
    });

    const fetched = await collectIpmaFeed({ feed: "seismic" }, { etag: '"mainland-v1"', lastModified: "Mon, 07 Sep 2026 16:36:02 GMT" }, ORIGIN, fetcher);

    if (fetched.kind !== "body") throw new Error("expected a source body");
    expect(fetched.provenance.sourcePublishedAt).toBe("2026-09-07T16:36:02.000Z");
    expect(await new Response(fetched.body).json()).toMatchObject({ azores: { data: [{ id: "azores-new" }] } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects a response over the feed-kind byte cap", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("{}", {
          headers: { "Content-Length": String(IPMA_FEED_LIMITS.seismic + 1) },
        }),
    );

    await expect(collectIpmaFeed({ feed: "seismic" }, undefined, ORIGIN, fetcher)).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("reports provider errors without returning their body", async () => {
    const fetcher = vi.fn(async () => new Response("unavailable", { status: 503 }));

    await expect(collectIpmaFeed({ feed: "daily-forecast" }, undefined, ORIGIN, fetcher)).rejects.toMatchObject({ code: "upstream-error" });
  });
});
