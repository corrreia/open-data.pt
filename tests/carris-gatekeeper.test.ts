import { describe, expect, it, vi } from "vitest";
import { collectCarrisFeed, validateCarrisFeedConfig } from "../apps/gatekeeper/src/sources/carris/carris";

describe("Carris Gatekeeper", () => {
  it("rejects unsupported feed names", () => {
    expect(() => validateCarrisFeedConfig({ feed: "arbitrary-url" })).toThrow("feed=lines, routes, stops, vehicles, or alerts");
  });

  it("keeps requests on the fixed API origin, forwards checkpoints, and types the body's provenance", async () => {
    const fetcher = vi.fn(async (url: URL | RequestInfo, init?: RequestInit) => {
      expect(url.toString()).toBe("https://api.carrismetropolitana.pt/v2/vehicles");
      const headers = new Headers(init?.headers);
      expect(headers.get("if-modified-since")).toBe("Sun, 06 Sep 2026 22:59:04 GMT");
      return new Response("[]", {
        headers: {
          "Content-Type": "application/json",
          "Last-Modified": "Sun, 06 Sep 2026 23:00:04 GMT",
        },
      });
    });

    const fetched = await collectCarrisFeed({ feed: "vehicles" }, { lastModified: "Sun, 06 Sep 2026 22:59:04 GMT" }, "https://api.carrismetropolitana.pt", fetcher);

    expect(fetched).toMatchObject({
      kind: "body",
      completeness: "complete",
      provenance: {
        sourceUrl: "https://api.carrismetropolitana.pt/v2/vehicles",
        sourcePublishedAt: "Sun, 06 Sep 2026 23:00:04 GMT",
      },
      validator: { lastModified: "Sun, 06 Sep 2026 23:00:04 GMT" },
    });
    if (fetched.kind !== "body") throw new Error("Expected a source body");
    expect(await new Response(fetched.body).text()).toBe("[]");
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("reports an unchanged source with the validator it answered with", async () => {
    const fetcher = vi.fn(async (_url: URL | RequestInfo, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("if-none-match")).toBe('"v1"');
      return new Response(null, { status: 304, headers: { ETag: '"v1"' } });
    });

    const fetched = await collectCarrisFeed({ feed: "lines" }, { etag: '"v1"' }, "https://api.carrismetropolitana.pt", fetcher);

    expect(fetched).toEqual({ kind: "not-modified", validator: { etag: '"v1"' } });
  });

  it("fails as an upstream error when the API does not answer 2xx", async () => {
    const fetcher = vi.fn(async () => new Response("busy", { status: 503 }));

    await expect(collectCarrisFeed({ feed: "alerts" }, undefined, "https://api.carrismetropolitana.pt", fetcher)).rejects.toMatchObject({
      name: "GatekeeperError",
      code: "upstream-error",
    });
  });
});
