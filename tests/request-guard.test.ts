import { describe, expect, it } from "vitest";
import { openApiDocument } from "../apps/kernel/src/openapi";
import { GuardError, MAX_FILTERS, canonicalRoute, isAllowedMethod, requestIdOf, withinRateLimit } from "../apps/kernel/src/request-guard";

const route = (path: string) => canonicalRoute(new URL(`https://open-data.pt${path}`));

describe("canonical routes", () => {
  it("stores one cache entry per request, whatever the parameter order", () => {
    const first = route("/api/products/stops/records?where=kind%3Abus&limit=5&where=city%3ALisboa");
    const second = route("/api/products/stops/records?where=city%3ALisboa&where=kind%3Abus&limit=5");
    expect(first?.url.href).toBe(second?.url.href);
    expect([...(first?.url.searchParams.keys() ?? [])]).toEqual(["limit", "where", "where"]);
  });

  it("refuses unknown and repeated parameters, and too many filters", () => {
    expect(() => route("/api/products/stops/events?from=a&to=b&feedId=other")).toThrow(GuardError);
    expect(() => route("/api/products?_r=1")).toThrow(/no query parameters/);
    expect(() => route("/api/products/stops/records?limit=1&limit=2")).toThrow(/only once/);
    const filters = Array.from({ length: MAX_FILTERS + 1 }, (_, index) => `where=f${index}%3Ax`).join("&");
    expect(() => route(`/api/products/stops/records?${filters}`)).toThrow(/At most/);
  });

  it("marks history windows and GeoJSON as costly, and leaves unknown paths to the 404", () => {
    expect(route("/api/products/stops/events?from=a&to=b")?.costly).toBe(true);
    expect(route("/api/products/stops/series/changes/range?from=a&to=b")?.costly).toBe(true);
    expect(route("/api/products/stops.geojson")?.costly).toBe(true);
    expect(route("/api/products/stops/records/all")?.costly).toBe(true);
    expect(route("/api/products/stops/records")?.costly).toBe(false);
    expect(route("/api/config")).toBeUndefined();
    // The API serves data and collection status, not the platform's own machinery.
    for (const path of ["/api/usage", "/api/sync", "/api/policies", "/api/gatekeepers", "/api/feed-kinds", "/api/activity", "/api/feeds/f1/acquisitions", "/api/feeds/f1/backfill"])
      expect(route(path)).toBeUndefined();
    expect(route("/api/acquisitions?day=2026-09-01&feedId=f1&limit=5")?.costly).toBe(false);
  });

  it("accepts every query parameter the OpenAPI document publishes", () => {
    for (const [path, item] of Object.entries(openApiDocument("https://open-data.pt").paths)) {
      const url = new URL(`https://open-data.pt${path.replace("{slug}", "stops").replace("{feedId}", "feed_1").replace("{period}", "2026-09")}`);
      for (const parameter of item.get.parameters) if (parameter.in === "query") url.searchParams.set(parameter.name, "1");
      expect(() => canonicalRoute(url), path).not.toThrow();
      expect(canonicalRoute(url), path).toBeDefined();
    }
  });

  it("names every route as the OpenAPI document does, which is how usage analytics count it", () => {
    for (const path of Object.keys(openApiDocument("https://open-data.pt").paths)) {
      const url = new URL(`https://open-data.pt${path.replace("{slug}", "stops").replace("{feedId}", "feed_1").replace("{period}", "2026-09")}`);
      expect(canonicalRoute(url)?.template, path).toBe(path);
    }
  });
});

describe("methods, limits and request IDs", () => {
  it("answers only GET, HEAD and OPTIONS", () => {
    for (const method of ["GET", "HEAD", "OPTIONS"]) expect(isAllowedMethod(method)).toBe(true);
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) expect(isAllowedMethod(method)).toBe(false);
  });

  it("keys both limiters on the client IP and applies the costly one only to costly routes", async () => {
    const calls: string[] = [];
    const limiter = (name: string, success: boolean) => ({
      limit: async ({ key }: { key: string }) => {
        calls.push(`${name}:${key}`);
        return { success };
      },
    });
    const request = new Request("https://open-data.pt/api/products", { headers: { "cf-connecting-ip": "192.0.2.7" } });
    expect(await withinRateLimit({ api: limiter("api", true), costly: limiter("costly", false) }, request, false)).toBe(true);
    expect(await withinRateLimit({ api: limiter("api", true), costly: limiter("costly", false) }, request, true)).toBe(false);
    expect(await withinRateLimit({ api: limiter("api", false) }, request, false)).toBe(false);
    expect(await withinRateLimit({}, request, true)).toBe(true);
    expect(calls).toEqual(["api:192.0.2.7", "api:192.0.2.7", "costly:192.0.2.7", "api:192.0.2.7"]);
  });

  it("quotes the Cloudflare ray ID when there is one", () => {
    expect(requestIdOf(new Request("https://open-data.pt/api", { headers: { "cf-ray": "8f0c1d2e3a4b5c6d-LIS" } }))).toBe("8f0c1d2e3a4b5c6d-LIS");
    expect(requestIdOf(new Request("https://open-data.pt/api"))).toMatch(/^[0-9a-f-]{36}$/);
  });
});
