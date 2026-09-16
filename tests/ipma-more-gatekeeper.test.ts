import type { JsonValue } from "@open-data-pt/gatekeeper-shared";
import { describe, expect, it, vi } from "vitest";
import { collectIpmaFeed, IPMA_FEED_LIMITS, validateIpmaFeedConfig } from "../packages/gatekeeper-shared/src/sources/ipma/ipma";

const ORIGIN = "https://api.ipma.pt";

function jsonResponse(value: JsonValue | undefined, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(value), {
    headers: { "Content-Type": "application/json", ...Object.fromEntries(new Headers(headers)) },
  });
}

describe("IPMA additional Gatekeeper feeds", () => {
  it("validates the four feed kinds and rejects caller-controlled hosts", () => {
    for (const feed of ["warnings", "uv-index", "fire-risk", "sea-forecast"]) {
      expect(validateIpmaFeedConfig({ feed })).toEqual({ feed });
    }
    expect(() => validateIpmaFeedConfig({ feed: "warnings", host: "evil.example" })).toThrow("does not accept host");
  });

  it("collects warnings with lookup metadata and provenance", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = input.toString();
      if (url.endsWith("warnings_www.json")) {
        return jsonResponse([{ idAreaAviso: "LSB" }], {
          ETag: '"warnings-v2"',
          "Last-Modified": "Mon, 07 Sep 2026 20:15:01 GMT",
        });
      }
      if (url.endsWith("distrits-islands.json")) {
        return jsonResponse({ data: [{ idAreaAviso: "LSB", local: "Lisboa" }] });
      }
      throw new Error(`Unexpected URL ${url}`);
    });

    const fetched = await collectIpmaFeed({ feed: "warnings" }, undefined, ORIGIN, fetcher);

    expect(fetched).toMatchObject({
      kind: "body",
      completeness: "complete",
      provenance: {
        sourceUrl: "https://api.ipma.pt/open-data/forecast/warnings/warnings_www.json",
        sourcePublishedAt: "2026-09-07T20:15:01.000Z",
      },
      validator: { etag: '"warnings-v2"' },
    });
    if (fetched.kind !== "body") throw new Error("expected a source body");
    expect(await new Response(fetched.body).json()).toEqual({
      warnings: [{ idAreaAviso: "LSB" }],
      areas: { data: [{ idAreaAviso: "LSB", local: "Lisboa" }] },
    });
  });

  it("fetches every UV component even when an old primary validator exists", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).has("if-none-match")).toBe(false);
      return input.toString().endsWith("uv.json")
        ? jsonResponse([{ globalIdLocal: 1110600, iUv: 3 }], { ETag: '"uv-v2"' })
        : jsonResponse({ data: [{ globalIdLocal: 1110600, local: "Lisboa" }] });
    });

    const fetched = await collectIpmaFeed({ feed: "uv-index" }, { etag: '"uv-v1"', lastModified: "Mon, 07 Sep 2026 20:00:17 GMT" }, ORIGIN, fetcher);

    expect(fetched).toMatchObject({ kind: "body", validator: { etag: '"uv-v2"' } });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("enforces the fire-risk byte cap before buffering", async () => {
    const fetcher = vi.fn(
      async () =>
        new Response("{}", {
          headers: { "Content-Length": String(IPMA_FEED_LIMITS["fire-risk"] + 1) },
        }),
    );

    await expect(collectIpmaFeed({ feed: "fire-risk" }, undefined, ORIGIN, fetcher)).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("rejects a misconfigured origin and reports provider errors without exposing the body", async () => {
    await expect(collectIpmaFeed({ feed: "sea-forecast" }, undefined, "https://evil.example", vi.fn())).rejects.toMatchObject({ code: "source-denied" });

    const fetcher = vi.fn(async () => new Response("provider details", { status: 503 }));
    await expect(collectIpmaFeed({ feed: "sea-forecast" }, undefined, ORIGIN, fetcher)).rejects.toMatchObject({ code: "upstream-error" });
  });
});
