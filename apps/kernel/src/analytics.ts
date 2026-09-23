/**
 * Public usage analytics. Every request the kernel answers for a person or a
 * program becomes one Workers Analytics Engine data point, and /api/analytics
 * reads the aggregate back for the /analytics/ page. Nothing else stores it: no
 * Durable Object, no R2, no lake. Analytics Engine keeps three months.
 *
 * A data point holds no IP address, no cookie and no identifier of a visitor:
 * only what was asked for, by what kind of client, from which country, and how
 * it went.
 */
import { asArray, asNumber, asObject, asString, isJsonObject, parseJson, type JsonObject, type JsonValue } from "@open-data-pt/contract";

import { isbot } from "isbot";
import { parse as parseReferrer } from "ts-referer-parser";

import { isPage, pagePath } from "./markdown";
import { NAMING_PARAMETER } from "./page-meta";
import { routeTemplate } from "./request-guard";

/** The dataset every data point is written to; wrangler.jsonc binds it as USAGE. */
export const USAGE_DATASET = "open_data_pt_usage";

/** How long Analytics Engine keeps a data point, and so the longest window the page offers. */
export const ANALYTICS_RETENTION_DAYS = 90;
/** The windows /api/analytics answers; one cache entry each keeps the read queries few. */
export const ANALYTICS_WINDOWS = [1, 7, 30, 90] as const;
/** The report changes slowly and every miss costs several read queries, so the edge keeps it this long. */
export const ANALYTICS_TTL_SECONDS = 1800;

/**
 * Where a request arrived. `mcp-read` is an API read made by an MCP code run:
 * it tells which data assistants read, and is counted apart from the MCP
 * messages that caused it.
 */
export type Surface = "api" | "web" | "mcp" | "mcp-read" | "docs" | "discovery";

/** What sent a request, as far as its User-Agent tells. */
export type ClientKind = "browser" | "library" | "ai-agent" | "crawler" | "unknown";

export interface Client {
  kind: ClientKind;
  name: string;
}

/** An MCP message: its JSON-RPC method, the tool it calls, and the client's own name when it introduces itself. */
export interface McpCall {
  method: string;
  tool: string;
  client: string;
}

export type CacheOutcome = "hit" | "miss" | "none";

/** One answered request, as the recorder sees it. */
export interface UsageEvent {
  surface: Surface;
  /** The request's own URL, or the API URL an MCP code run read. */
  url: URL;
  request: Request;
  response: Response;
  durationMs: number;
  cache: CacheOutcome;
  mcp?: McpCall | undefined;
}

/** Longest client, referrer or subject name kept; longer ones are cut. */
const MAX_NAME = 64;
/** Analytics Engine takes at most 250 data points per invocation; an MCP run that reads more is counted only this far. */
const MAX_POINTS_PER_REQUEST = 200;

/* ---------- Where and what ---------- */

const DISCOVERY = /^\/(sitemap\.xml|mcp\/server-card|\.well-known\/.+)$/;

/** The surface a path belongs to, or undefined for files the analytics does not count (scripts, styles, images). */
export function surfaceOf(url: URL): Surface | undefined {
  const path = url.pathname;
  if (path === "/api" || path.startsWith("/api/")) return "api";
  if (path === "/mcp") return "mcp";
  if (path === "/docs" || path === "/docs/" || path === "/openapi.json") return "docs";
  if (DISCOVERY.test(path)) return "discovery";
  if (isPage(path)) return "web";
  return undefined;
}

/** The route a request took, named as the OpenAPI document or the site names it; never the raw URL. */
export function routeOf(surface: Surface, url: URL): string {
  if (surface === "api" || surface === "mcp-read") return routeTemplate(url.pathname) ?? "(unknown)";
  if (surface === "web") return pagePath(url.pathname);
  if (surface === "docs") return url.pathname === "/docs/" ? "/docs" : url.pathname;
  // Any /.well-known/ path counts as discovery, including made-up ones of any length.
  return clip(url.pathname);
}

const SUBJECT_IN_PATH = /^\/api\/(?:products|feeds)\/([^/]+?)(?:\.geojson|\/.*)?$/;

/** The product, feed, publisher, licence or topic a request is about, when it names one. */
export function subjectOf(surface: Surface, url: URL): string {
  if (surface === "api" || surface === "mcp-read") {
    const match = SUBJECT_IN_PATH.exec(url.pathname);
    return match?.[1] ? clip(safeDecode(match[1])) : "";
  }
  if (surface === "web") {
    const parameter = NAMING_PARAMETER.get(pagePath(url.pathname));
    return parameter ? clip(url.searchParams.get(parameter) ?? "") : "";
  }
  return "";
}

/* ---------- Who ---------- */

type ClientRule = readonly [pattern: RegExp, kind: ClientKind, name: string];

/**
 * HTTP libraries and command-line tools: people's scripts. They come before
 * the bot test, which counts most of them as bots.
 */
const LIBRARY_RULES: readonly ClientRule[] = [
  [/^curl\//i, "library", "curl"],
  [/^wget\//i, "library", "Wget"],
  [/^httpie\//i, "library", "HTTPie"],
  [/python-requests/i, "library", "Python requests"],
  [/python-httpx/i, "library", "Python httpx"],
  [/aiohttp/i, "library", "Python aiohttp"],
  [/python-urllib|^python\//i, "library", "Python urllib"],
  [/scrapy/i, "library", "Scrapy"],
  [/^node$|^node\//i, "library", "Node.js fetch"],
  [/^undici/i, "library", "Node.js undici"],
  [/node-fetch/i, "library", "node-fetch"],
  [/^axios\//i, "library", "axios"],
  [/^deno\//i, "library", "Deno"],
  [/^bun\//i, "library", "Bun"],
  [/go-http-client/i, "library", "Go net/http"],
  [/^okhttp/i, "library", "OkHttp"],
  [/apache-httpclient/i, "library", "Apache HttpClient"],
  [/^java\//i, "library", "Java"],
  [/^dart\//i, "library", "Dart"],
  [/reqwest/i, "library", "Rust reqwest"],
  [/^httr|r-curl|^r \(/i, "library", "R"],
  [/^libcurl/i, "library", "libcurl"],
  [/powershell/i, "library", "PowerShell"],
  [/guzzlehttp/i, "library", "PHP Guzzle"],
  [/^ruby|faraday/i, "library", "Ruby"],
  [/postmanruntime/i, "library", "Postman"],
  [/^insomnia/i, "library", "Insomnia"],
];

/** Browsers, tried last: Edge, Opera and Samsung also say Chrome; Chrome also says Safari. */
const BROWSER_RULES: readonly ClientRule[] = [
  [/edg(e|a|ios)?\//i, "browser", "Edge"],
  [/opr\/|opera/i, "browser", "Opera"],
  [/samsungbrowser/i, "browser", "Samsung Internet"],
  [/firefox|fxios/i, "browser", "Firefox"],
  [/chrome|crios|chromium/i, "browser", "Chrome"],
  [/safari/i, "browser", "Safari"],
];

/** AI assistants fetching for a person, and AI crawlers, by the maker or product their User-Agent names. */
const AI_AGENT =
  /gpt|oai-|openai|claude|anthropic|perplexity|mistral|cohere|deepseek|qwen|grok|kimi|moonshot|pangu|chatglm|yibot|bytespider|ccbot|ai2bot|youbot|diffbot|amazonbot|meta-external|duckassist|vertexbot|gemini|phind|webmcp/i;
/**
 * isbot counts every client that is not a browser, a person's own script too.
 * A crawler also dresses as a browser, calls itself one, or links to its page.
 */
const CRAWLER_SIGN = /^mozilla\/|bot|crawl|spider|slurp|https?:\/\//i;
/** The product token a crawler names itself by. */
const CRAWLER_WORD = /bot|crawl|spider|slurp|fetch|scan|preview|check|monitor|agent|user/i;
/** Words browsers and platforms send, which never name a bot. */
const NOT_A_NAME =
  /^(mozilla|applewebkit|khtml|like|gecko|compatible|chrome|safari|version|mobile|firefox|windows|win64|wow64|x64|x11|linux|ubuntu|macintosh|intel|android|iphone|ipad|cpu|u|msie|trident|java|en-us|sv1)$/i;
/** Product tokens whose own spelling reads badly, by their lower case. */
const PLAIN_NAMES = new Map([
  ["claude-code", "Claude Code"],
  ["cohere-ai", "Cohere"],
  ["anthropic-ai", "Anthropic"],
  ["facebookexternalhit", "Facebook"],
  ["facebookcatalog", "Facebook"],
  ["adsbot-google", "Google Ads"],
  ["mediapartners-google", "Google Ads"],
  ["headlesschrome", "Headless Chrome"],
  ["chrome-lighthouse", "Lighthouse"],
  ["slackbot-linkexpanding", "Slackbot"],
  ["slack-imgproxy", "Slackbot"],
]);
/** Anything else is named by its first product token. */
const PRODUCT_TOKEN = /^([a-z0-9][a-z0-9._ -]*?)(?:\/|\s\(|$)/i;

/**
 * What sent a request, from its User-Agent. An empty one is unknown: every
 * browser sends one. Scripts first, then AI agents, then anything isbot calls
 * a bot, then browsers, because most bots also say "Mozilla" and "Chrome".
 */
export function classifyClient(userAgent: string | null): Client {
  const agent = userAgent?.trim() ?? "";
  if (!agent) return { kind: "unknown", name: "(none)" };
  const rule = LIBRARY_RULES.find(([pattern]) => pattern.test(agent));
  if (rule) return { kind: rule[1], name: rule[2] };
  if (AI_AGENT.test(agent)) return { kind: "ai-agent", name: botName(agent, AI_AGENT) };
  if (isbot(agent) && CRAWLER_SIGN.test(agent)) return { kind: "crawler", name: botName(agent, CRAWLER_WORD) };
  const browser = BROWSER_RULES.find(([pattern]) => pattern.test(agent));
  if (browser) return { kind: browser[1], name: browser[2] };
  return { kind: "unknown", name: clip(PRODUCT_TOKEN.exec(agent)?.[1]?.trim() || "(other)") };
}

/**
 * A bot's name: the first phrase that says what it is ("ClaudeBot" in
 * "…compatible; ClaudeBot/1.0; +claudebot@anthropic.com", "Better Uptime
 * Bot"), else the first after "compatible;", else its first product token that
 * is not a browser's, else its first phrase. Links and addresses never count.
 */
function botName(agent: string, says: RegExp): string {
  const phrases = agent.split(/[;()]/).map(phraseOf);
  const compatible = phrases.findIndex((phrase) => /^compatible$/i.test(phrase));
  const named = phrases.filter((phrase) => phrase && !NOT_A_NAME.test(phrase.split(/[\s,]/)[0] ?? ""));
  const product = [...agent.matchAll(/([a-z][\w.-]*)\/v?\d/gi)].map((match) => match[1] ?? "").find((word) => !NOT_A_NAME.test(word));
  const name =
    named.find((phrase) => says.test(phrase)) ??
    (compatible >= 0 ? phrases.slice(compatible + 1).find((phrase) => named.includes(phrase)) : undefined) ??
    product ??
    named[0] ??
    "(other)";
  return clip(PLAIN_NAMES.get(name.toLowerCase()) ?? name);
}

/**
 * The words of a User-Agent segment, past any browser's product tokens and up
 * to a link, an address or a version: "Yanga WorldSearch Bot v1.1/beta" →
 * "Yanga WorldSearch Bot", "Chrome/45.0 Safari/537.36 SWIMGBot" → "SWIMGBot".
 */
function phraseOf(segment: string): string {
  const words: string[] = [];
  for (const word of segment.trim().split(/\s+/)) {
    if (!word || word.startsWith("+") || word.includes("://") || word.includes("@")) break;
    const [product = "", version] = word.split("/");
    if (version === undefined) {
      words.push(word);
      continue;
    }
    if (NOT_A_NAME.test(product) && words.length === 0) continue;
    if (product && !NOT_A_NAME.test(product)) words.push(product);
    break;
  }
  return words
    .join(" ")
    .replace(/\s+v?[\d.]+$/i, "")
    .replace(/^[\s,:-]+|[\s,:-]+$/g, "");
}

/** Who linked to a page: a source's name, such as Google or Microsoft Teams, and its medium. */
export interface ReferrerSource {
  referrer: string;
  medium: string;
}

/** Hosts the referrer list (ts-referer-parser) does not name, with their medium. */
const UNLISTED_SOURCES: ReadonlyArray<readonly [pattern: RegExp, name: string, medium: string]> = [
  [/(^|\.)teams\.[\w.]*(microsoft\.com|live\.com|office\.net|static\.microsoft)$/, "Microsoft Teams", "social"],
  [/(^|\.)outlook\.(office|office365|live)\.com$/, "Outlook", "email"],
  [/(^|\.)m365\.cloud\.microsoft$/, "Microsoft Copilot", "chatbot"],
  [/^claude\.com$/, "Claude.ai", "chatbot"],
  [/^pplx\.ai$/, "Perplexity.ai", "chatbot"],
  [/(^|\.)kimi\.(com|moonshot\.cn)$/, "Kimi", "chatbot"],
  [/^duck\.ai$/, "Duck.ai", "chatbot"],
  [/(^|\.)slack\.com$/, "Slack", "social"],
  [/^t\.me$/, "Telegram", "social"],
  [/(^|\.)whatsapp\.com$/, "WhatsApp", "social"],
  [/(^|\.)baidu\.com$/, "Baidu", "search"],
  [/(^|\.)kagi\.com$/, "Kagi", "search"],
];

/** Sources the referrer list still knows by an old name. */
const RENAMED_SOURCES = new Map([["Twitter", "X"]]);

/** Where a visitor came from: the linking site's host; empty from this site or with no Referer. */
export function referrerOf(request: Request, url: URL): string {
  const referer = request.headers.get("Referer");
  if (!referer) return "";
  let host: string;
  try {
    host = new URL(referer).hostname.toLowerCase();
  } catch {
    return "";
  }
  if (!host || host === url.hostname) return "";
  return clip(host.replace(/^www\./, ""));
}

/**
 * A referrer's name and medium (search, social, email, chatbot or unknown).
 * Named when the report is read, not when it is written, so a source the list
 * learns to name is named for the whole window. Data points written before
 * hosts were kept hold an AI assistant's name, which has no dot.
 */
export function referrerSource(host: string): ReferrerSource {
  if (!host.includes(".")) return { referrer: host, medium: "chatbot" };
  const unlisted = UNLISTED_SOURCES.find(([pattern]) => pattern.test(host));
  if (unlisted) return { referrer: unlisted[1], medium: unlisted[2] };
  const parsed = parseReferrer(`https://${host}/`);
  const name = parsed.referer ?? host;
  return { referrer: RENAMED_SOURCES.get(name) ?? name, medium: parsed.medium };
}

/**
 * Requests this site's own pages make with fetch(): API reads for a page
 * already counted as a page view. Counting them again would make the API look
 * busy with its own website.
 */
export function isOwnPageFetch(request: Request): boolean {
  return request.headers.get("Sec-Fetch-Site") === "same-origin" && request.headers.get("Sec-Fetch-Mode") !== "navigate";
}

/** The first message of an MCP POST: its method, the tool it calls, and the client's name on initialize. */
export function mcpCallOf(body: JsonValue): McpCall | undefined {
  const messages = Array.isArray(body) ? body : [body];
  const message = messages.map((item) => asObject(item)).find((item) => asString(item?.method));
  if (!message) return undefined;
  const params = asObject(message.params);
  const initialize = messages.map((item) => asObject(item)).find((item) => item?.method === "initialize");
  return {
    method: clip(asString(initialize?.method) ?? asString(message.method) ?? ""),
    tool: message.method === "tools/call" ? clip(asString(params?.name) ?? "") : "",
    client: clip(asString(asObject(asObject(initialize?.params)?.clientInfo)?.name) ?? ""),
  };
}

/* ---------- The data point ---------- */

/**
 * Where each field goes. Blobs are strings, doubles numbers, and the index is
 * the sampling key: sampling, if Cloudflare ever applies it, thins the busiest
 * surface first and leaves the others whole.
 */
export function usagePoint(event: UsageEvent): AnalyticsEngineDataPoint {
  const client = classifyClient(event.request.headers.get("User-Agent"));
  const country = event.request.cf?.country;
  return {
    indexes: [event.surface],
    blobs: [
      routeOf(event.surface, event.url),
      subjectOf(event.surface, event.url),
      client.kind,
      client.name,
      country === undefined ? "" : String(country),
      event.surface === "mcp-read" ? "" : referrerOf(event.request, event.url),
      statusClass(event.response.status),
      event.cache,
      event.mcp ? (event.mcp.tool ? `${event.mcp.method} ${event.mcp.tool}` : event.mcp.method) : "",
      event.mcp?.client ?? "",
      formatOf(event.response.headers.get("Content-Type")),
    ],
    doubles: [Math.max(0, event.durationMs)],
  };
}

function statusClass(status: number): string {
  if (status === 429) return "429";
  return `${Math.floor(status / 100)}xx`;
}

/** The answer's format by its media type: html, markdown, json, geo, problem, xml. */
function formatOf(contentType: string | null): string {
  const type = contentType?.split(";")[0]?.trim().toLowerCase() ?? "";
  if (!type) return "";
  if (type === "application/problem+json") return "problem";
  if (type === "application/geo+json") return "geojson";
  if (type.endsWith("json")) return "json";
  return type.slice(type.indexOf("/") + 1).replace(/^x-/, "");
}

/**
 * Writes one request's data points. Writing never waits and never throws: a
 * page is answered whether or not it was counted. Tests and local runs may
 * have no dataset bound.
 */
export class UsageRecorder {
  private written = 0;

  constructor(private readonly dataset: AnalyticsEngineDataset | undefined) {}

  record(event: UsageEvent): void {
    if (!this.dataset || this.written >= MAX_POINTS_PER_REQUEST) return;
    this.written += 1;
    try {
      this.dataset.writeDataPoint(usagePoint(event));
    } catch (error) {
      console.error(JSON.stringify({ event: "usage_write_failed", error: error instanceof Error ? error.message : String(error) }));
    }
  }
}

/* ---------- The report ---------- */

export interface AnalyticsReport {
  days: number;
  resolution: "hour" | "day";
  from: string;
  to: string;
  retentionDays: number;
  /** Requests per hour or day, by surface and client kind. */
  timeline: Array<{ time: string; surface: string; kind: string; requests: number }>;
  clients: Array<{ surface: string; kind: string; name: string; requests: number }>;
  routes: Array<{ surface: string; route: string; requests: number; meanMs: number }>;
  subjects: Array<{ surface: string; route: string; subject: string; requests: number }>;
  countries: Array<{ surface: string; country: string; requests: number }>;
  /** Named by referrerSource, so hosts of one source add up. */
  referrers: Array<{ surface: string; referrer: string; medium: string; requests: number }>;
  outcomes: Array<{ surface: string; status: string; cache: string; format: string; requests: number }>;
  mcp: Array<{ call: string; client: string; requests: number }>;
}

/** The report's parts, each one query. */
type ReportPart = "timeline" | "clients" | "routes" | "subjects" | "countries" | "referrers" | "outcomes" | "mcp";

/** Why the report could not be built: no token on this deployment, or Analytics Engine did not answer. */
export class AnalyticsError extends Error {
  constructor(
    message: string,
    readonly failure: "disabled" | "store",
  ) {
    super(message);
    this.name = "AnalyticsError";
  }
}

const QUERY_TIMEOUT_MS = 15_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** Every count is a sum of sample intervals, so it stays right if Cloudflare samples. */
const REQUESTS = "SUM(_sample_interval) AS requests";

/** The span a report covers, and the size of its timeline's buckets. */
export interface ReportWindow {
  from: Date;
  to: Date;
  resolution: "hour" | "day";
}

/**
 * The report's window: the last 24 whole-and-current hours for one day, or
 * whole UTC days back from today for longer windows.
 */
export function reportWindow(days: number, now: number): ReportWindow {
  if (days === 1) return { from: new Date(Math.floor(now / HOUR_MS) * HOUR_MS - 23 * HOUR_MS), to: new Date(now), resolution: "hour" };
  return { from: new Date(Math.floor(now / DAY_MS) * DAY_MS - (days - 1) * DAY_MS), to: new Date(now), resolution: "day" };
}

/** The SQL text of each part of the report. Every value in it is a constant or a date this module formats. */
export function reportQueries(from: Date, resolution: "hour" | "day"): Map<ReportPart, string> {
  const where = `WHERE timestamp >= toDateTime('${sqlTime(from)}')`;
  const bucket = resolution === "hour" ? "INTERVAL '1' HOUR" : "INTERVAL '1' DAY";
  const table = USAGE_DATASET;
  return new Map<ReportPart, string>([
    [
      "timeline",
      `SELECT toStartOfInterval(timestamp, ${bucket}) AS time, index1 AS surface, blob3 AS kind, ${REQUESTS} FROM ${table} ${where} GROUP BY time, surface, kind ORDER BY time LIMIT 10000`,
    ],
    ["clients", `SELECT index1 AS surface, blob3 AS kind, blob4 AS name, ${REQUESTS} FROM ${table} ${where} GROUP BY surface, kind, name ORDER BY requests DESC LIMIT 500`],
    [
      "routes",
      `SELECT index1 AS surface, blob1 AS route, ${REQUESTS}, SUM(_sample_interval * double1) / SUM(_sample_interval) AS meanMs FROM ${table} ${where} GROUP BY surface, route ORDER BY requests DESC LIMIT 300`,
    ],
    [
      "subjects",
      `SELECT index1 AS surface, blob1 AS route, blob2 AS subject, ${REQUESTS} FROM ${table} ${where} AND blob2 != '' GROUP BY surface, route, subject ORDER BY requests DESC LIMIT 500`,
    ],
    ["countries", `SELECT index1 AS surface, blob5 AS country, ${REQUESTS} FROM ${table} ${where} AND blob5 != '' GROUP BY surface, country ORDER BY requests DESC LIMIT 500`],
    ["referrers", `SELECT index1 AS surface, blob6 AS referrer, ${REQUESTS} FROM ${table} ${where} AND blob6 != '' GROUP BY surface, referrer ORDER BY requests DESC LIMIT 200`],
    [
      "outcomes",
      `SELECT index1 AS surface, blob7 AS status, blob8 AS cache, blob11 AS format, ${REQUESTS} FROM ${table} ${where} GROUP BY surface, status, cache, format ORDER BY requests DESC LIMIT 500`,
    ],
    ["mcp", `SELECT blob9 AS call, blob10 AS client, ${REQUESTS} FROM ${table} ${where} AND index1 = 'mcp' GROUP BY call, client ORDER BY requests DESC LIMIT 200`],
  ]);
}

/**
 * The aggregate the /analytics/ page draws, read from Analytics Engine's SQL
 * API with the ANALYTICS_TOKEN secret (Account Analytics: Read).
 */
export async function analyticsReport(
  env: Pick<Env, "ANALYTICS_TOKEN" | "CLOUDFLARE_ACCOUNT_ID">,
  days: number,
  now = Date.now(),
  fetcher: typeof fetch = (input, init) => fetch(input, init),
): Promise<AnalyticsReport> {
  if (!env.ANALYTICS_TOKEN) throw new AnalyticsError("Analytics queries are not enabled on this deployment", "disabled");
  const window = reportWindow(days, now);
  const queries = reportQueries(window.from, window.resolution);
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/analytics_engine/sql`;
  const results = new Map(await Promise.all([...queries].map(async ([part, sql]) => [part, await runAnalyticsQuery(endpoint, env.ANALYTICS_TOKEN, sql, fetcher)] as const)));
  const rows = (part: ReportPart) => results.get(part) ?? [];
  const text = (row: JsonObject, name: string) => asString(row[name]) ?? "";
  const count = (row: JsonObject, name: string) => numeric(row[name]);
  return {
    days,
    resolution: window.resolution,
    from: window.from.toISOString(),
    to: window.to.toISOString(),
    retentionDays: ANALYTICS_RETENTION_DAYS,
    timeline: rows("timeline").map((row) => ({ time: isoTime(text(row, "time")), surface: text(row, "surface"), kind: text(row, "kind"), requests: count(row, "requests") })),
    clients: rows("clients").map((row) => ({ surface: text(row, "surface"), kind: text(row, "kind"), name: text(row, "name"), requests: count(row, "requests") })),
    routes: rows("routes").map((row) => ({ surface: text(row, "surface"), route: text(row, "route"), requests: count(row, "requests"), meanMs: Math.round(count(row, "meanMs")) })),
    subjects: rows("subjects").map((row) => ({ surface: text(row, "surface"), route: text(row, "route"), subject: text(row, "subject"), requests: count(row, "requests") })),
    countries: rows("countries").map((row) => ({ surface: text(row, "surface"), country: text(row, "country"), requests: count(row, "requests") })),
    referrers: namedReferrers(rows("referrers").map((row) => ({ surface: text(row, "surface"), host: text(row, "referrer"), requests: count(row, "requests") }))),
    outcomes: rows("outcomes").map((row) => ({
      surface: text(row, "surface"),
      status: text(row, "status"),
      cache: text(row, "cache"),
      format: text(row, "format"),
      requests: count(row, "requests"),
    })),
    mcp: rows("mcp").map((row) => ({ call: text(row, "call"), client: text(row, "client"), requests: count(row, "requests") })),
  };
}

async function runAnalyticsQuery(endpoint: string, token: string, sql: string, fetcher: typeof fetch): Promise<JsonObject[]> {
  let response: Response;
  try {
    response = await fetcher(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
      body: `${sql} FORMAT JSON`,
      signal: AbortSignal.timeout(QUERY_TIMEOUT_MS),
    });
  } catch (error) {
    throw new AnalyticsError(`Analytics Engine could not be reached: ${error instanceof Error ? error.message : String(error)}`, "store");
  }
  const body = await response.text();
  if (!response.ok) throw new AnalyticsError(`Analytics Engine answered HTTP ${response.status}: ${body.slice(0, 300)}`, "store");
  let payload: JsonObject | undefined;
  try {
    payload = asObject(parseJson(body));
  } catch {
    throw new AnalyticsError("Analytics Engine answered with something other than JSON", "store");
  }
  const data = asArray(payload?.data);
  if (!data || !data.every(isJsonObject)) throw new AnalyticsError("Analytics Engine answered without a data array", "store");
  return data;
}

/* ---------- Pieces ---------- */

/** Referrer rows by source name, adding up the hosts one source links from (google.pt and google.com.hk are both Google). */
function namedReferrers(rows: Array<{ surface: string; host: string; requests: number }>): AnalyticsReport["referrers"] {
  const named = new Map<string, AnalyticsReport["referrers"][number]>();
  for (const { surface, host, requests } of rows) {
    const source = referrerSource(host);
    const key = `${surface}|${source.referrer}`;
    const row = named.get(key);
    if (row) row.requests += requests;
    else named.set(key, { surface, ...source, requests });
  }
  return [...named.values()].sort((a, b) => b.requests - a.requests);
}

/** ClickHouse quotes 64-bit integers in JSON; read either form. */
function numeric(value: JsonValue | undefined): number {
  const number = asNumber(value) ?? Number(asString(value) ?? Number.NaN);
  return Number.isFinite(number) ? number : 0;
}

/** "2026-09-19 00:00:00" (UTC, as Analytics Engine writes it) → ISO 8601. */
function isoTime(value: string): string {
  const time = Date.parse(`${value.replace(" ", "T")}Z`);
  return Number.isNaN(time) ? value : new Date(time).toISOString();
}

/** A date as Analytics Engine's toDateTime reads it, in UTC. */
function sqlTime(date: Date): string {
  return date.toISOString().slice(0, 19).replace("T", " ");
}

function clip(value: string): string {
  return value.length > MAX_NAME ? value.slice(0, MAX_NAME) : value;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
