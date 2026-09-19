import { describe, expect, it } from "vitest";
import {
  AnalyticsError,
  UsageRecorder,
  analyticsReport,
  classifyClient,
  isOwnPageFetch,
  mcpCallOf,
  referrerOf,
  reportWindow,
  routeOf,
  subjectOf,
  surfaceOf,
  usagePoint,
  type UsageEvent,
} from "../apps/kernel/src/analytics";

const site = (path: string) => new URL(`https://open-data.pt${path}`);

describe("who sent a request", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36", "browser", "Chrome"],
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0", "browser", "Edge"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:142.0) Gecko/20100101 Firefox/142.0", "browser", "Firefox"],
    ["Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1", "browser", "Safari"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ChatGPT-User/1.0; +https://openai.com/bot)", "ai-agent", "ChatGPT-User"],
    ["Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)", "ai-agent", "ClaudeBot"],
    ["Claude-User/1.0; +Claude-User@anthropic.com", "ai-agent", "Claude-User"],
    ["Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)", "crawler", "Googlebot"],
    ["Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) HeadlessChrome/140.0.0.0 Safari/537.36", "crawler", "Headless Chrome"],
    ["SomeNewBot/1.2 (+https://example.org)", "crawler", "SomeNewBot"],
    ["curl/8.14.1", "library", "curl"],
    ["python-requests/2.32.4", "library", "Python requests"],
    ["python-httpx/0.28.1", "library", "Python httpx"],
    ["node", "library", "Node.js fetch"],
    ["Go-http-client/2.0", "library", "Go net/http"],
    ["httr2/1.1.2 r-curl/6.2.3 libcurl/8.5.0", "library", "R"],
    ["PostmanRuntime/7.44.1", "library", "Postman"],
    ["MyDashboard/3.0 (contact: someone@example.org)", "unknown", "MyDashboard"],
  ])("%s → %s %s", (agent, kind, name) => {
    expect(classifyClient(agent)).toEqual({ kind, name });
  });

  it("calls a request without a User-Agent unknown", () => {
    expect(classifyClient(null)).toEqual({ kind: "unknown", name: "(none)" });
    expect(classifyClient("  ")).toEqual({ kind: "unknown", name: "(none)" });
  });

  it("names the linking site, or the AI assistant it belongs to, and nothing from this site", () => {
    const from = (referer: string) => referrerOf(new Request("https://open-data.pt/", { headers: { Referer: referer } }), site("/"));
    expect(from("https://chatgpt.com/c/123")).toBe("ChatGPT");
    expect(from("https://www.claude.ai/chat/abc")).toBe("Claude");
    expect(from("https://www.google.com/search?q=dados")).toBe("google.com");
    expect(from("https://open-data.pt/catalog/")).toBe("");
    expect(from("not a url")).toBe("");
    expect(referrerOf(new Request("https://open-data.pt/"), site("/"))).toBe("");
  });

  it("leaves out the API reads this site's own pages make, but not navigations", () => {
    const own = new Request("https://open-data.pt/api/products", { headers: { "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "cors" } });
    const clicked = new Request("https://open-data.pt/catalog/", { headers: { "Sec-Fetch-Site": "same-origin", "Sec-Fetch-Mode": "navigate" } });
    const elsewhere = new Request("https://open-data.pt/api/products", { headers: { "Sec-Fetch-Site": "cross-site", "Sec-Fetch-Mode": "cors" } });
    expect(isOwnPageFetch(own)).toBe(true);
    expect(isOwnPageFetch(clicked)).toBe(false);
    expect(isOwnPageFetch(elsewhere)).toBe(false);
    expect(isOwnPageFetch(new Request("https://open-data.pt/api/products"))).toBe(false);
  });
});

describe("where and what", () => {
  it("sorts paths into surfaces, and leaves the site's files uncounted", () => {
    expect(surfaceOf(site("/api/products"))).toBe("api");
    expect(surfaceOf(site("/api"))).toBe("api");
    expect(surfaceOf(site("/mcp"))).toBe("mcp");
    expect(surfaceOf(site("/mcp/server-card"))).toBe("discovery");
    expect(surfaceOf(site("/.well-known/api-catalog"))).toBe("discovery");
    expect(surfaceOf(site("/docs"))).toBe("docs");
    expect(surfaceOf(site("/openapi.json"))).toBe("docs");
    expect(surfaceOf(site("/"))).toBe("web");
    expect(surfaceOf(site("/product/index.html"))).toBe("web");
    expect(surfaceOf(site("/analytics/"))).toBe("web");
    expect(surfaceOf(site("/assets/index-abc.js"))).toBeUndefined();
  });

  it("names routes as the OpenAPI document does, never by their raw URL", () => {
    expect(routeOf("api", site("/api/products/carris-stops/records"))).toBe("/api/products/{slug}/records");
    expect(routeOf("mcp-read", site("/api/products/carris-stops.geojson"))).toBe("/api/products/{slug}.geojson");
    expect(routeOf("api", site("/api/nothing-here"))).toBe("(unknown)");
    expect(routeOf("web", site("/product/index.html"))).toBe("/product/");
    expect(routeOf("docs", site("/docs/"))).toBe("/docs");
  });

  it("keeps the product, feed, publisher or topic a request names", () => {
    expect(subjectOf("api", site("/api/products/carris-stops/series/summary/2026-09"))).toBe("carris-stops");
    expect(subjectOf("api", site("/api/products/carris-stops.geojson"))).toBe("carris-stops");
    expect(subjectOf("api", site("/api/feeds/feed_abc"))).toBe("feed_abc");
    expect(subjectOf("api", site("/api/products"))).toBe("");
    expect(subjectOf("web", site("/product/?slug=ipma-warnings&tab=map"))).toBe("ipma-warnings");
    expect(subjectOf("web", site("/catalog/?topic=energy"))).toBe("energy");
    expect(subjectOf("web", site("/status/"))).toBe("");
  });

  it("reads an MCP message's method, tool and client", () => {
    expect(mcpCallOf({ jsonrpc: "2.0", id: 1, method: "initialize", params: { clientInfo: { name: "claude-ai", version: "0.1.0" } } })).toEqual({
      method: "initialize",
      tool: "",
      client: "claude-ai",
    });
    expect(mcpCallOf({ jsonrpc: "2.0", id: 2, method: "tools/call", params: { name: "execute", arguments: { code: "1" } } })).toEqual({
      method: "tools/call",
      tool: "execute",
      client: "",
    });
    expect(
      mcpCallOf([
        { jsonrpc: "2.0", method: "notifications/initialized" },
        { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
      ])?.method,
    ).toBe("initialize");
    expect(mcpCallOf({ jsonrpc: "2.0", id: 3, result: {} })).toBeUndefined();
  });
});

function event(overrides: Partial<UsageEvent> = {}): UsageEvent {
  return {
    surface: "api",
    url: site("/api/products/carris-stops/records?limit=5"),
    request: new Request("https://open-data.pt/api/products/carris-stops/records?limit=5", { headers: { "User-Agent": "curl/8.14.1", Referer: "https://chatgpt.com/" } }),
    response: new Response("{}", { status: 200, headers: { "Content-Type": "application/json" } }),
    durationMs: 12,
    cache: "hit",
    ...overrides,
  };
}

describe("the data point", () => {
  it("puts each field where the report's queries read it", () => {
    expect(usagePoint(event())).toEqual({
      indexes: ["api"],
      blobs: ["/api/products/{slug}/records", "carris-stops", "library", "curl", "", "ChatGPT", "2xx", "hit", "", "", "json"],
      doubles: [12],
    });
  });

  it("records MCP calls, rate limits and problem answers", () => {
    const point = usagePoint(
      event({
        surface: "mcp",
        url: site("/mcp"),
        response: new Response("{}", { status: 429, headers: { "Content-Type": "application/problem+json" } }),
        cache: "none",
        mcp: { method: "tools/call", tool: "execute", client: "" },
      }),
    );
    expect(point.indexes).toEqual(["mcp"]);
    expect(point.blobs?.slice(6)).toEqual(["429", "none", "tools/call execute", "", "problem"]);
  });

  it("does not credit an MCP code run's reads to a referrer", () => {
    expect(usagePoint(event({ surface: "mcp-read" })).blobs?.[5]).toBe("");
  });

  it("writes at most 200 points a request, and never throws", () => {
    const written: AnalyticsEngineDataPoint[] = [];
    const recorder = new UsageRecorder({ writeDataPoint: (point) => void written.push(point ?? {}) });
    for (let index = 0; index < 250; index += 1) recorder.record(event());
    expect(written).toHaveLength(200);

    const failing = new UsageRecorder({
      writeDataPoint: () => {
        throw new Error("dataset unavailable");
      },
    });
    expect(() => failing.record(event())).not.toThrow();
    expect(() => new UsageRecorder(undefined).record(event())).not.toThrow();
  });
});

describe("the report", () => {
  const now = Date.parse("2026-09-19T14:25:00Z");

  it("covers the last 24 hours by hour, or whole UTC days by day", () => {
    const hourly = reportWindow(1, now);
    expect(hourly.from.toISOString()).toBe("2026-09-18T15:00:00.000Z");
    expect(hourly.resolution).toBe("hour");
    const weekly = reportWindow(7, now);
    expect(weekly.from.toISOString()).toBe("2026-09-13T00:00:00.000Z");
    expect(weekly.resolution).toBe("day");
  });

  it("asks Analytics Engine one query per part, and reads its quoted counts", async () => {
    const sent: string[] = [];
    const fetcher: typeof fetch = async (input, init) => {
      expect(String(input)).toBe("https://api.cloudflare.com/client/v4/accounts/test-account/analytics_engine/sql");
      expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer test-token");
      const sql = String(init?.body);
      sent.push(sql);
      if (sql.includes("toStartOfInterval")) return Response.json({ data: [{ time: "2026-09-19 00:00:00", surface: "api", kind: "library", requests: "42" }] });
      if (sql.includes("meanMs")) return Response.json({ data: [{ surface: "api", route: "/api/products", requests: 7, meanMs: 18.4 }] });
      return Response.json({ data: [] });
    };
    const report = await analyticsReport({ ANALYTICS_TOKEN: "test-token", CLOUDFLARE_ACCOUNT_ID: "test-account" }, 7, now, fetcher);

    expect(sent).toHaveLength(8);
    for (const sql of sent) {
      expect(sql).toContain("FROM open_data_pt_usage WHERE timestamp >= toDateTime('2026-09-13 00:00:00')");
      expect(sql).toContain("SUM(_sample_interval) AS requests");
      expect(sql).toMatch(/ FORMAT JSON$/);
    }
    expect(report.timeline).toEqual([{ time: "2026-09-19T00:00:00.000Z", surface: "api", kind: "library", requests: 42 }]);
    expect(report.routes).toEqual([{ surface: "api", route: "/api/products", requests: 7, meanMs: 18 }]);
    expect(report).toMatchObject({ days: 7, resolution: "day", from: "2026-09-13T00:00:00.000Z", retentionDays: 90, clients: [], mcp: [] });
  });

  it("says when it is not enabled, and when Analytics Engine fails", async () => {
    await expect(analyticsReport({ ANALYTICS_TOKEN: "", CLOUDFLARE_ACCOUNT_ID: "a" }, 7, now)).rejects.toMatchObject({ failure: "disabled" });
    const failing: typeof fetch = async () => new Response("bad query", { status: 422 });
    await expect(analyticsReport({ ANALYTICS_TOKEN: "t", CLOUDFLARE_ACCOUNT_ID: "a" }, 7, now, failing)).rejects.toThrow(AnalyticsError);
  });
});
