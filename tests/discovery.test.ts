import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import type { JsonObject, JsonValue } from "@open-data-pt/gatekeeper-shared";
import { describe, expect, it } from "vitest";
import { SKILL_PATH, handleSite, type SiteHost } from "../apps/kernel/src/discovery";
import { prefersMarkdown } from "../apps/kernel/src/markdown";
import { jsonBody } from "./support";

const ORIGIN = "https://open-data.pt";
const BROWSER = "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";

const FUEL_FEED: JsonObject = {
  id: "feed_fuel",
  slug: "fuel",
  title: "Fuel prices",
  description: "Prices at every station.",
  publisher: { id: "dgeg", name: "Direção-Geral de Energia e Geologia", url: "https://www.dgeg.gov.pt/" },
  topics: ["energy"],
  format: "own-api",
  cadenceSeconds: 900,
  enabled: true,
  staleAfterSeconds: 3600,
  sourceUrl: "https://precoscombustiveis.dgeg.gov.pt/",
};
const POWER_FEED: JsonObject = {
  id: "feed_power",
  slug: "power",
  title: "Electricity consumption",
  description: "National consumption.",
  publisher: { id: "ren", name: "REN" },
  topics: ["energy"],
  format: "own-api",
  cadenceSeconds: 3600,
  enabled: true,
  staleAfterSeconds: 7200,
};
const FUEL: JsonObject = {
  slug: "fuel-stations",
  title: "Station prices",
  feedId: "feed_fuel",
  role: "current-state",
  schema: {
    fields: [
      { id: "station", name: "Station", type: "string" },
      { id: "price", name: "Price", type: "number", unit: "EUR/l" },
    ],
  },
  rowCount: 2,
  updatedAt: "2026-09-15T10:00:00.000Z",
  cadenceSeconds: 900,
  licence: { id: "cc-by-4.0", name: "CC BY 4.0", url: "https://creativecommons.org/licenses/by/4.0/" },
  attribution: "DGEG",
};
const POWER: JsonObject = {
  slug: "power-consumption",
  title: "Electricity consumption",
  feedId: "feed_power",
  role: "time-series",
  schema: { fields: [{ id: "value", name: "Value", type: "number", unit: "MWh" }] },
  rowCount: 48,
  updatedAt: "2026-09-15T09:00:00.000Z",
  cadenceSeconds: 3600,
};

const API = new Map<string, JsonValue>([
  ["/api/products", { data: [FUEL, POWER] }],
  ["/api/feeds", { data: [FUEL_FEED, POWER_FEED] }],
  ["/api/products/fuel-stations", FUEL],
  ["/api/feeds/feed_fuel", { data: FUEL_FEED }],
  ["/api/products/fuel-stations/records?limit=10", { data: [{ id: "a", station: "Galp | Lisboa", price: 1.789 }] }],
  ["/api/outages?days=3", { trackedSince: "2026-09-01T00:00:00.000Z", data: [{ feedId: "feed_power", startedAt: "2026-09-15T08:00:00.000Z", cause: "source", failures: 3 }] }],
]);

/** The API as fixtures, the site's real public files, and one small HTML document for every page. */
const host: SiteHost = {
  api: async (path) => {
    const body = API.get(path);
    return body === undefined ? Response.json({ type: "about:blank", title: "Not found", status: 404, detail: "Not found" }, { status: 404 }) : Response.json(body);
  },
  assets: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === SKILL_PATH || path === "/llms.txt") return new Response(readFileSync(`apps/site/public${path}`));
    if (path.endsWith("/")) return new Response("<!doctype html><title>open-data.pt</title>", { headers: { "Content-Type": "text/html" } });
    return new Response("Not found", { status: 404 });
  },
};

function get(path: string, headers: Record<string, string> = {}, method = "GET"): Promise<Response> {
  return handleSite(new Request(`${ORIGIN}${path}`, { method, headers }), host);
}

async function markdown(path: string): Promise<{ status: number; text: string }> {
  const response = await get(path, { Accept: "text/markdown" });
  return { status: response.status, text: await response.text() };
}

interface Links {
  href: string;
}

interface ServerCard {
  name: string;
  version: string;
  description: string;
  remotes: JsonValue;
  serverInfo: JsonValue;
}

interface AiCatalog {
  specVersion: string;
  host: { displayName: string; identifier: string };
  entries: Array<{ identifier: string; displayName: string; type: string; url: string; representativeQueries: string[] }>;
}

describe("agent discovery", () => {
  it("lists every page, publisher and product in a sitemap that robots.txt names", async () => {
    const response = await get("/sitemap.xml");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/xml; charset=utf-8");
    const sitemap = await response.text();
    expect(sitemap).toContain('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
    for (const page of ["/", "/catalog/", "/publisher/", "/licence/", "/start/", "/status/", "/contribute/", "/docs"]) expect(sitemap).toContain(`<loc>${ORIGIN}${page}</loc>`);
    expect(sitemap).toContain(`<loc>${ORIGIN}/product/?slug=fuel-stations</loc><lastmod>2026-09-15T10:00:00.000Z</lastmod>`);
    expect(sitemap).toContain(`<loc>${ORIGIN}/publisher/?id=dgeg</loc><lastmod>2026-09-15T10:00:00.000Z</lastmod>`);

    const robots = readFileSync("apps/site/public/robots.txt", "utf8");
    expect(robots).toContain(`Sitemap: ${ORIGIN}/sitemap.xml`);
    expect(robots).toContain(`Agentmap: ${ORIGIN}/.well-known/ai-catalog.json`);
  });

  it("publishes an RFC 9727 API catalog and names it on a HEAD request", async () => {
    const response = await get("/.well-known/api-catalog");
    expect(response.headers.get("Content-Type")).toBe('application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"');
    const { linkset } = await jsonBody<{ linkset: Array<{ anchor: string; "service-desc": Links[]; "service-doc": Links[]; status: Links[] }> }>(response);
    expect(linkset.map((entry) => entry.anchor)).toEqual([`${ORIGIN}/api`, `${ORIGIN}/mcp`]);
    expect(linkset[0]?.["service-desc"][0]?.href).toBe(`${ORIGIN}/openapi.json`);
    expect(linkset[0]?.["service-doc"].map((link) => link.href)).toEqual([`${ORIGIN}/docs`, `${ORIGIN}/llms.txt`]);
    expect(linkset[0]?.status[0]?.href).toBe(`${ORIGIN}/api/health`);

    const head = await get("/.well-known/api-catalog", {}, "HEAD");
    expect(head.headers.get("Link")).toBe('</.well-known/api-catalog>; rel="api-catalog"');
    expect(await head.text()).toBe("");
    expect((await get("/.well-known/api-catalog", {}, "POST")).status).toBe(405);
  });

  it("serves one MCP Server Card beside the endpoint and under .well-known, revalidated by ETag", async () => {
    const beside = await get("/mcp/server-card");
    const wellKnown = await get("/.well-known/mcp/server-card.json");
    expect(beside.headers.get("Content-Type")).toBe("application/mcp-server-card+json");
    expect(wellKnown.headers.get("Content-Type")).toBe("application/json");
    expect(wellKnown.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const card = await jsonBody<ServerCard>(beside);
    expect(await jsonBody<ServerCard>(wellKnown)).toEqual(card);
    expect(card.name).toMatch(/^[a-zA-Z0-9.-]+\/[a-zA-Z0-9._-]+$/);
    expect(card.description.length).toBeLessThanOrEqual(100);
    // The versions come from the MCP SDK the server runs on: dated revisions, newest first.
    expect(card.remotes).toEqual([{ type: "streamable-http", url: `${ORIGIN}/mcp`, supportedProtocolVersions: expect.arrayContaining(["2025-06-18"]) }]);
    expect(card.serverInfo).toEqual({ name: "open-data.pt", version: card.version });

    const etag = beside.headers.get("ETag") ?? "";
    expect(etag).toMatch(/^"[0-9a-f]{64}"$/);
    expect((await get("/mcp/server-card", { "If-None-Match": etag })).status).toBe(304);
  });

  it("lists the MCP server, the API, the skill and the datasets in an AI Catalog", async () => {
    const response = await get("/.well-known/ai-catalog.json");
    expect(response.headers.get("Content-Type")).toBe("application/json");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
    const catalog = await jsonBody<AiCatalog>(response);
    expect(catalog.specVersion).toBe("1.0");
    expect(catalog.host).toMatchObject({ displayName: "open-data.pt", identifier: "open-data.pt" });
    expect(catalog.entries.map((entry) => entry.url)).toEqual([`${ORIGIN}/mcp/server-card`, `${ORIGIN}/openapi.json`, `${ORIGIN}${SKILL_PATH}`, `${ORIGIN}/api/catalog.dcat.json`]);
    for (const entry of catalog.entries) {
      expect(entry.identifier).toMatch(/^urn:air:open-data\.pt:[a-z]+:[a-z-]+$/);
      expect(entry.displayName).not.toBe("");
      expect(entry.type).toMatch(/^application\//);
      expect("data" in entry).toBe(false);
      expect(entry.representativeQueries.length).toBeGreaterThanOrEqual(2);
      expect(entry.representativeQueries.length).toBeLessThanOrEqual(5);
    }
  });

  it("indexes the Agent Skill with the digest of the bytes it serves", async () => {
    const index = await jsonBody<{ $schema: string; skills: Array<{ description: string }> }>(await get("/.well-known/agent-skills/index.json"));
    const skill = readFileSync(`apps/site/public${SKILL_PATH}`);
    expect(index.$schema).toBe("https://schemas.agentskills.io/discovery/0.2.0/schema.json");
    expect(index.skills).toEqual([
      {
        name: "open-data-pt",
        type: "skill-md",
        description: expect.stringContaining("Portuguese public data"),
        url: SKILL_PATH,
        digest: `sha256:${createHash("sha256").update(skill).digest("hex")}`,
      },
    ]);
    expect(skill.toString("utf8")).toContain(`\ndescription: ${index.skills[0]?.description}\n`);
    expect(skill.toString("utf8")).toMatch(/^---\nname: open-data-pt\n/);
  });

  it("weighs the Accept header to choose Markdown", () => {
    expect(prefersMarkdown("text/markdown")).toBe(true);
    expect(prefersMarkdown("text/html;q=0.5, text/markdown")).toBe(true);
    expect(prefersMarkdown("text/markdown;q=0.5, text/html")).toBe(false);
    expect(prefersMarkdown(BROWSER)).toBe(false);
    expect(prefersMarkdown("*/*")).toBe(false);
    expect(prefersMarkdown(null)).toBe(false);
  });

  it("answers a page in Markdown to an agent that asks, and in HTML with discovery links to everyone else", async () => {
    const answer = await get("/", { Accept: "text/markdown" });
    expect(answer.status).toBe(200);
    expect(answer.headers.get("Content-Type")).toBe("text/markdown; charset=utf-8");
    expect(Number(answer.headers.get("x-markdown-tokens"))).toBeGreaterThan(0);
    expect(answer.headers.get("Vary")).toBe("Accept");
    const text = await answer.text();
    expect(text).toMatch(/^# open-data\.pt\n/);
    expect(text).toContain("2 datasets, 2 tables and series, from 2 publishers.");
    expect(text).toContain(`- [Energy](${ORIGIN}/catalog/?topic=energy): 2 datasets from`);

    const html = await get("/", { Accept: BROWSER });
    expect(html.headers.get("Content-Type")).toBe("text/html");
    expect(html.headers.get("Vary")).toBe("Accept");
    const links = html.headers.get("Link") ?? "";
    for (const relation of [
      '</>; rel="alternate"; type="text/markdown"',
      '</.well-known/api-catalog>; rel="api-catalog"',
      'rel="service-desc"',
      'rel="service-doc"',
      'rel="describedby"',
    ])
      expect(links).toContain(relation);

    const script = await get("/assets/page.js", { Accept: "text/markdown" });
    expect(script.status).toBe(404);
    expect(script.headers.get("Link")).toBeNull();
  });

  it("describes a product with its fields, first rows and API links, and says when there is none", async () => {
    const { text } = await markdown("/product/?slug=fuel-stations");
    expect(text).toContain("# Station prices\n");
    expect(text).toContain(`- **Publisher:** [Direção-Geral de Energia e Geologia](${ORIGIN}/publisher/?id=dgeg)`);
    expect(text).toContain(`- **Licence:** [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) — ${ORIGIN}/licence/?id=cc-by-4.0`);
    expect(text).toContain("| `price` | Price | number | EUR/l |");
    expect(text).toContain("| Galp \\| Lisboa | 1.789 |");
    expect(text).toContain(`- Rows: ${ORIGIN}/api/products/fuel-stations/records?limit=500`);

    const missing = await markdown("/product/?slug=nothing-here");
    expect(missing.status).toBe(404);
    expect(missing.text).toContain("# Product not found");
  });

  it("uses a three-day window for status history and page metadata", async () => {
    const answer = await markdown("/status/");
    expect(answer.status).toBe(200);
    expect(answer.text).toContain("in the last 3 days");
    expect(answer.text).toContain(`${ORIGIN}/api/outages?days=3`);
    expect(answer.text).not.toContain("days=90");
    const html = readFileSync("apps/site/status/index.html", "utf8");
    expect(html).toContain("over the last 3 days.");
    expect(html).not.toContain("90 days");
  });

  it("gives the other pages in Markdown too", async () => {
    expect((await markdown("/catalog/?topic=energy")).text).toContain("# Energy\n\n2 datasets about energy");
    expect((await markdown("/publisher/?id=ren")).text).toContain("# REN\n");
    expect((await markdown("/publisher/?id=nobody")).status).toBe(404);
    expect((await markdown("/licence/")).text).toContain(`- [CC BY 4.0](${ORIGIN}/licence/?id=cc-by-4.0): 1 dataset from 1 publisher`);
    expect((await markdown("/licence/?id=cc-by-4.0")).text).toContain("# CC BY 4.0\n");
    expect((await markdown("/licence/?id=nobody")).status).toBe(404);
    expect((await markdown("/status/")).text).toContain("- **Electricity consumption**: not collected since 2026-09-15T08:00:00.000Z, 3 failed attempts (cause: source)");
    expect((await markdown("/operations/")).text).toContain("| Fuel prices | Direção-Geral de Energia e Geologia | every 15 minutes |");
    expect((await markdown("/start/")).text).toContain("# open-data.pt\n\n> Free, keyless JSON API");
  });
});
