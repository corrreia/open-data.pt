/**
 * What an agent finds on its own: the sitemap, the API catalog (RFC 9727), the
 * MCP Server Card, the AI Catalog and the Agent Skills index; Link headers
 * (RFC 8288) on every page; and every page as Markdown for a client that asks
 * for text/markdown. All of it is public and read-only, built on each read
 * from the same API any client reads and from the site's own files.
 */
import { sha256Hex } from "./hash";
import type { HeaderMap } from "./http";
import { isPage, pageMarkdown, prefersMarkdown, productPage, publisherPage, readCatalog } from "./markdown";
import { withPageMeta } from "./page-meta";

/** The MCP server's name and version: what /mcp answers initialize with, and what its Server Card says. */
export const MCP_SERVER_NAME = "open-data.pt";
export const MCP_SERVER_VERSION = "0.1.0";

/** The one Agent Skill: a static file of the site build, so the index hashes the bytes clients download. */
export const SKILL_PATH = "/.well-known/agent-skills/open-data-pt/SKILL.md";

/** Pages every visitor can reach without a query; products and publishers follow from the API. */
const SITEMAP_PAGES = ["/", "/catalog/", "/publisher/", "/start/", "/status/", "/operations/", "/contribute/", "/docs"];

/** Words every AI Catalog entry shares, for registries that filter by tag. */
const TAGS = ["portugal", "open data", "public data", "energy", "mobility", "weather", "health", "economy", "telecom"];

/** What the site's pages and documents read. */
export interface SiteHost {
  /** A GET of an /api path, answered as for any client: edge cache, rate limits, problem+json errors. */
  api: (path: string) => Promise<Response>;
  /** The site build's static files. */
  assets: (request: Request) => Promise<Response>;
}

interface Document {
  body: string;
  type: string;
  /** How long clients may keep it, in seconds. */
  maxAge: number;
  headers?: HeaderMap;
}

type Builder = (origin: string, host: SiteHost) => Promise<Document>;

/** Every document here is public and read-only, so any page may read it. */
const CORS: HeaderMap = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, If-None-Match",
  "Access-Control-Expose-Headers": "ETag, Link",
};

const DOCUMENTS = new Map<string, Builder>([
  ["/sitemap.xml", sitemap],
  ["/.well-known/api-catalog", apiCatalog],
  ["/.well-known/ai-catalog.json", aiCatalog],
  ["/.well-known/agent-skills/index.json", skillsIndex],
  // The card's recommended place is beside the endpoint; scanners look for it under .well-known.
  ["/mcp/server-card", async (origin) => serverCard(origin, "application/mcp-server-card+json")],
  ["/.well-known/mcp/server-card.json", async (origin) => serverCard(origin, "application/json")],
]);

/** Everything outside /api, /mcp, /docs and /openapi.json: discovery documents, then pages, then the site's files. */
export async function handleSite(request: Request, host: SiteHost): Promise<Response> {
  const url = new URL(request.url);
  const read = request.method === "GET" || request.method === "HEAD";
  const build = DOCUMENTS.get(url.pathname);
  if (build) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (!read) return new Response(null, { status: 405, headers: { ...CORS, Allow: "GET, HEAD, OPTIONS" } });
    return serve(request, await build(url.origin, host));
  }
  if (!read || !isPage(url.pathname)) return host.assets(request);

  const links = pageLinks(`${url.pathname}${url.search}`);
  const page = prefersMarkdown(request.headers.get("Accept")) ? await pageMarkdown(url, host) : undefined;
  if (page) {
    return new Response(request.method === "HEAD" ? null : page.markdown, {
      status: page.status,
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        // An estimate, as Cloudflare's Markdown for Agents gives one: about four characters a token.
        "x-markdown-tokens": String(Math.ceil(page.markdown.length / 4)),
        "Cache-Control": "public, max-age=60",
        Vary: "Accept",
        Link: links,
      },
    });
  }
  const html = await host.assets(request);
  const rewrite = request.method === "GET" && html.ok && html.headers.get("Content-Type")?.startsWith("text/html") === true;
  const answer = rewrite ? new Response(await withPageMeta(await html.text(), url, host), html) : new Response(html.body, html);
  if (rewrite) {
    // The file's validators no longer describe these bytes, which change with the query.
    for (const header of ["ETag", "Last-Modified", "Content-Length"]) answer.headers.delete(header);
  }
  answer.headers.set("Link", links);
  answer.headers.append("Vary", "Accept");
  return answer;
}

/** RFC 8288 links on every page: this page as Markdown, and where the API, its description and its documentation are. */
function pageLinks(target: string): string {
  return [
    `<${target}>; rel="alternate"; type="text/markdown"`,
    '</.well-known/api-catalog>; rel="api-catalog"',
    '</openapi.json>; rel="service-desc"; type="application/vnd.oai.openapi+json"',
    '</docs>; rel="service-doc"; type="text/html"',
    '</llms.txt>; rel="describedby"; type="text/plain"',
    '</.well-known/ai-catalog.json>; rel="ai-catalog"; type="application/json"',
  ].join(", ");
}

/** A document with an entity tag, so a client that already has it gets 304. */
async function serve(request: Request, document: Document): Promise<Response> {
  const etag = `"${await sha256Hex(document.body)}"`;
  const headers: HeaderMap = { ...CORS, "Content-Type": document.type, "Cache-Control": `public, max-age=${document.maxAge}`, ETag: etag, ...document.headers };
  const known = request.headers
    .get("If-None-Match")
    ?.split(",")
    .map((tag) => tag.trim().replace(/^W\//, ""));
  if (known?.includes(etag) || known?.includes("*")) return new Response(null, { status: 304, headers });
  return new Response(request.method === "HEAD" ? null : document.body, { headers });
}

/** Every page worth finding: the site's own, then each publisher and product the API lists now. */
async function sitemap(origin: string, host: SiteHost): Promise<Document> {
  const datasets = await readCatalog(host);
  const entries: Array<{ loc: string; lastmod?: string }> = SITEMAP_PAGES.map((path) => ({ loc: `${origin}${path}` }));
  const publishers = new Map<string, string>();
  for (const { feed, products } of datasets) {
    for (const item of products) {
      const page = publisherPage(feed.publisher);
      if ((publishers.get(page) ?? "") < item.updatedAt) publishers.set(page, item.updatedAt);
    }
  }
  for (const [page, lastmod] of publishers) entries.push({ loc: `${origin}${page}`, lastmod });
  for (const { products } of datasets) for (const item of products) entries.push({ loc: `${origin}${productPage(item.slug)}`, lastmod: item.updatedAt });
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(({ loc, lastmod }) => `  <url><loc>${xml(loc)}</loc>${lastmod ? `<lastmod>${xml(lastmod)}</lastmod>` : ""}</url>`),
    "</urlset>",
    "",
  ].join("\n");
  return { body, type: "application/xml; charset=utf-8", maxAge: 3600 };
}

/** RFC 9727: the API and the MCP server, each with its description, documentation and health check. */
async function apiCatalog(origin: string): Promise<Document> {
  const status = [{ href: `${origin}/api/health`, type: "application/json" }];
  const linkset = [
    {
      anchor: `${origin}/api`,
      "service-desc": [{ href: `${origin}/openapi.json`, type: "application/vnd.oai.openapi+json" }],
      "service-doc": [
        { href: `${origin}/docs`, type: "text/html" },
        { href: `${origin}/llms.txt`, type: "text/plain" },
      ],
      status,
    },
    {
      anchor: `${origin}/mcp`,
      "service-desc": [{ href: `${origin}/mcp/server-card`, type: "application/mcp-server-card+json" }],
      "service-doc": [{ href: `${origin}/start/#mcp`, type: "text/html" }],
      status,
    },
  ];
  return {
    body: JSON.stringify({ linkset }, null, 2),
    type: 'application/linkset+json; profile="https://www.rfc-editor.org/info/rfc9727"',
    maxAge: 3600,
    // RFC 9727 section 2: a HEAD of the catalog answers with this link.
    headers: { Link: '</.well-known/api-catalog>; rel="api-catalog"' },
  };
}

/** The MCP Server Card (SEP-2127): who the server is and where to connect. It lists no tools; clients ask the server. */
async function serverCard(origin: string, type: string): Promise<Document> {
  // Loaded here rather than at the top, so page and API reads never evaluate the MCP SDK's schemas.
  const { SUPPORTED_PROTOCOL_VERSIONS } = await import("@modelcontextprotocol/sdk/types.js");
  const card = {
    $schema: "https://static.modelcontextprotocol.io/schemas/v1/server-card.schema.json",
    name: "pt.open-data/mcp",
    version: MCP_SERVER_VERSION,
    title: MCP_SERVER_NAME,
    description: "Portuguese public data: search the API's description and read it, in code, with no key.",
    websiteUrl: `${origin}/start/#mcp`,
    icons: [{ src: `${origin}/favicon.svg`, mimeType: "image/svg+xml", sizes: ["any"] }],
    remotes: [{ type: "streamable-http", url: `${origin}/mcp`, supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS }],
    // The earlier draft (SEP-1649) named the server here, and some scanners still read it.
    serverInfo: { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
  };
  return { body: JSON.stringify(card, null, 2), type, maxAge: 3600 };
}

/** The AI Catalog (ARD): the MCP server, the API, the Agent Skill and the dataset catalog, with questions each answers. */
async function aiCatalog(origin: string): Promise<Document> {
  const host = new URL(origin).hostname;
  const identifier = (namespace: string, name: string) => `urn:air:${host}:${namespace}:${name}`;
  const catalog = {
    specVersion: "1.0",
    host: { displayName: "open-data.pt", identifier: host, documentationUrl: `${origin}/start/`, logoUrl: `${origin}/favicon.svg` },
    entries: [
      {
        identifier: identifier("mcp", "open-data-pt"),
        displayName: "open-data.pt MCP server",
        description: "Portuguese public data for AI assistants: search the API's description and read it, in code, with no key.",
        type: "application/mcp-server-card+json",
        url: `${origin}/mcp/server-card`,
        tags: TAGS,
        representativeQueries: [
          "What do petrol stations in Lisbon charge for diesel today?",
          "Is there an IPMA weather warning for Porto?",
          "How much electricity did Portugal consume yesterday?",
          "Where are Carris Metropolitana buses right now?",
        ],
      },
      {
        identifier: identifier("api", "open-data-pt"),
        displayName: "open-data.pt API",
        description: "OpenAPI 3.1 description of a free, keyless, read-only JSON API over Portuguese public data.",
        type: "application/vnd.oai.openapi+json",
        url: `${origin}/openapi.json`,
        tags: TAGS,
        representativeQueries: ["Portuguese public data as JSON", "Electricity production by source in Portugal", "Earthquakes recorded by IPMA this month"],
      },
      {
        identifier: identifier("skill", "open-data-pt"),
        displayName: "Portuguese public data from open-data.pt",
        description: "An Agent Skill that says how to find and read open-data.pt's datasets through its MCP server or its API.",
        type: "application/agent-skills+md",
        url: `${origin}${SKILL_PATH}`,
        tags: TAGS,
        representativeQueries: ["Find open data published by Portuguese institutions", "Read a Portuguese government dataset", "Fuel prices in Portugal"],
      },
      {
        identifier: identifier("dataset", "catalog"),
        displayName: "open-data.pt dataset catalog",
        description: "Every dataset on open-data.pt as DCAT 3 JSON-LD: publisher, licence, topics and distributions.",
        type: "application/ld+json",
        url: `${origin}/api/catalog.dcat.json`,
        tags: TAGS,
        representativeQueries: ["Catalog of Portuguese open datasets and their licences", "Which Portuguese institutions publish open data?"],
      },
    ],
  };
  return { body: JSON.stringify(catalog, null, 2), type: "application/json", maxAge: 3600 };
}

/** The Agent Skills discovery index (v0.2.0), with the skill's description and digest read from the file itself. */
async function skillsIndex(origin: string, host: SiteHost): Promise<Document> {
  const response = await host.assets(new Request(new URL(SKILL_PATH, origin)));
  if (!response.ok) throw new Error(`${SKILL_PATH} answered ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  const description = /^description:\s*(.+)$/m.exec(new TextDecoder().decode(bytes))?.[1]?.trim();
  if (!description) throw new Error(`${SKILL_PATH} has no description`);
  const index = {
    $schema: "https://schemas.agentskills.io/discovery/0.2.0/schema.json",
    skills: [{ name: "open-data-pt", type: "skill-md", description, url: SKILL_PATH, digest: `sha256:${await sha256Hex(bytes)}` }],
  };
  return { body: JSON.stringify(index, null, 2), type: "application/json", maxAge: 3600 };
}

const xml = (text: string) => text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
