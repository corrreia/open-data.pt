/**
 * The MCP server at /mcp: the public API for AI assistants, built on Cloudflare
 * Code Mode. It has two tools. `search` runs the model's JavaScript against the
 * OpenAPI document; `execute` runs it against the API. Each run is a fresh
 * Dynamic Worker with no network access: its only way out is
 * `codemode.request()`, which the kernel answers through the same edge cache,
 * rate limits and read-only routes as any HTTP client.
 *
 * The server is stateless: every POST gets its own server and transport and is
 * answered with JSON, never a stream, so there is no session to keep.
 */
import type { ExecuteResult, Executor } from "@cloudflare/codemode";
import { openApiMcpServer, type RequestOptions } from "@cloudflare/codemode/mcp";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { asObject, asString, parseJson, type JsonValue } from "@open-data-pt/gatekeeper-shared";

import { MCP_SERVER_NAME, MCP_SERVER_VERSION } from "./discovery";
import { openApiDocument } from "./openapi";

/** The largest API answer handed to sandbox code; bigger reads page with a cursor or narrow with filters. */
export const MAX_READ_BYTES = 8 * 1024 * 1024;

/** Seconds a client waits after using up its code runs for the minute: the rate-limit period. */
const RUN_RETRY_SECONDS = 60;

/**
 * Where hosted assistants call MCP servers from. Every user of one shares these
 * addresses, so a caller from here is counted by its MCP session instead.
 * Anthropic lists 160.79.104.0/21 for outbound MCP calls
 * (https://platform.claude.com/docs/en/api/ip-addresses); 2607:6bc0::/48 is its
 * IPv6 block (ARIN ANTHROPIC-V6).
 */
const HOSTED_ASSISTANT_RANGES = ["160.79.104.0/21", "2607:6bc0::/48"];

/** The session numbers this server hands out: random UUIDs. */
const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Accept, Mcp-Protocol-Version, Mcp-Session-Id, Last-Event-ID",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

/** Appended to the execute tool's description: what the API holds and how to read it well. */
const GUIDE = `open-data.pt is a free, keyless, read-only JSON API over Portuguese public data: energy, mobility, weather and environment, health, statistics, cities. Only GET requests to paths under /api work.

- Start with GET /api/products: every product's slug, title, description, role, schema, rowCount, cadence and freshness. Filter that list in your code; do not return it whole.
- The role says how to read a product. reference, current-state, event-log and summary: GET /api/products/{slug}/records (limit up to 500; pass nextCursor back as cursor), or /records/all for every row at once. time-series: GET /api/products/{slug}/series (seriesKey, from, to, limit up to 1000).
- Filter records with where=field:value (up to five, all must match) and bbox=minLon,minLat,maxLon,maxLat. Pass several where filters as an array: query: { where: ["line:1", "status:open"] }.
- History: /events, /series/range, /changes/range and /series/changes/range take from and to (ISO 8601, at most 366 days apart), page with nextCursor, and report their coverage.
- GET /api/feeds says where each dataset comes from and who publishes it; GET /api/outages says when a source was down.
- A failed read throws an Error carrying the HTTP status and detail. After a 429, wait before retrying. Answers over 8 MB are refused: page or filter instead.
- What you return is cut to about 6,000 tokens, so return only what the answer needs.
- The data belongs to its publishers: cite the licence and attribution on the product, not open-data.pt.`;

/** What the MCP endpoint needs from the kernel. */
export interface McpHost {
  /** Runs sandboxed code: a Dynamic Worker in production, anything that keeps the contract in tests. */
  executor: Executor;
  /** One API read, answered as for any HTTP client: edge cache, rate limits, problem+json errors. */
  read: (request: Request) => Promise<Response>;
  /** Who the rate limits count this caller as; see mcpClientKey. */
  clientKey: string;
}

export async function handleMcp(request: Request, host: McpHost): Promise<Response> {
  const url = new URL(request.url);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (request.method === "GET" && request.headers.get("Accept")?.includes("text/html")) {
    // A person who opens the address in a browser gets the page that explains it.
    return Response.redirect(new URL("/start/#mcp", url.origin).toString(), 302);
  }
  if (request.method !== "POST") {
    // Stateless: there is no session to hold a stream open on or to delete.
    return Response.json(
      { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed: send MCP messages with POST." }, id: null },
      { status: 405, headers: { ...CORS, Allow: "POST, OPTIONS" } },
    );
  }

  const initializing = await isInitialize(request);
  const server = openApiMcpServer({
    name: MCP_SERVER_NAME,
    version: MCP_SERVER_VERSION,
    spec: openApiDocument(url.origin),
    executor: host.executor,
    description: GUIDE,
    request: async (options) => apiRead(options, request, host),
  });
  // No session ID generator: the transport is stateless.
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true });
  await server.connect(transport);
  try {
    const response = await transport.handleRequest(request);
    const answered = new Response(response.body, response);
    for (const [name, value] of Object.entries(CORS)) answered.headers.set(name, value);
    // Clients send the number back on every request, which tells a hosted assistant's conversations apart. Nothing is stored under it.
    if (initializing && response.ok) answered.headers.set("Mcp-Session-Id", crypto.randomUUID());
    return answered;
  } finally {
    await server.close();
  }
}

/**
 * One `codemode.request()` from sandbox code, answered on the host. It reads
 * the API as the MCP client would over HTTP: same origin, same client address
 * for the rate limits, GET only. A failed read throws, so the code can catch it.
 */
export async function apiRead(options: RequestOptions, client: Request, host: McpHost): Promise<JsonValue> {
  const origin = new URL(client.url).origin;
  if (options.method !== "GET") throw new Error("The open-data.pt API is read-only; use GET.");
  const url = new URL(options.path, origin);
  if (url.origin !== origin || !/^\/api(\/|$)/.test(url.pathname)) throw new Error(`Only paths under /api can be read, such as /api/products; not ${options.path}`);
  for (const [name, value] of Object.entries(options.query ?? {})) {
    if (value === undefined) continue;
    // Models pass repeated filters as arrays even where the types say otherwise; `where` repeats.
    for (const item of Array.isArray(value) ? value : [value]) url.searchParams.append(name, String(item));
  }

  // The API's rate limits key on cf-connecting-ip, which only Cloudflare sets on a real request; on this internal one it names the MCP caller.
  const headers = new Headers({ Accept: "application/json", "cf-connecting-ip": host.clientKey });
  const ray = client.headers.get("cf-ray");
  if (ray) headers.set("cf-ray", ray);
  const target = `GET ${url.pathname}${url.search}`;
  const response = await host.read(new Request(url, { headers }));
  const text = await boundedText(response, target);
  if (!response.ok) {
    const detail = problemDetail(text);
    const retry = response.status === 429 ? ` Retry after ${response.headers.get("Retry-After") ?? RUN_RETRY_SECONDS} seconds.` : "";
    throw new Error(`${target} answered ${response.status}${detail ? `: ${detail}` : ""}${retry}`);
  }
  try {
    return parseJson(text);
  } catch {
    throw new Error(`${target} did not answer JSON`);
  }
}

/**
 * Every code run is a fresh Dynamic Worker, and Cloudflare bills each one, so a
 * client gets a bounded number a minute. A refused run is a tool error the
 * model can read and act on, not a failed request.
 */
export function limitRuns(executor: Executor, allowed: () => Promise<boolean>): Executor {
  return {
    execute: async (code, providers, options): Promise<ExecuteResult> => {
      if (!(await allowed())) return { result: undefined, error: `This client ran too much code in the last minute; wait ${RUN_RETRY_SECONDS} seconds and try again.` };
      return executor.execute(code, providers, options);
    },
  };
}

/**
 * Who the rate limits count a caller as: its address, or its MCP session when
 * it calls from a hosted assistant, whose users all share a few addresses.
 * Sessions count only from those ranges, so nobody else can dodge the limits by
 * inventing session numbers.
 */
export function mcpClientKey(request: Request): string {
  const address = request.headers.get("cf-connecting-ip") ?? "anonymous";
  const session = request.headers.get("Mcp-Session-Id")?.toLowerCase();
  return session && SESSION_ID.test(session) && fromHostedAssistant(address) ? `mcp-session:${session}` : address;
}

export function fromHostedAssistant(address: string): boolean {
  const ip = parseAddress(address);
  return ip !== undefined && HOSTED_ASSISTANT_RANGES.some((range) => withinRange(ip, range));
}

/** An IPv4 or IPv6 address as a number, with its width in bits. */
interface Address {
  value: bigint;
  bits: 32 | 128;
}

function withinRange(ip: Address, range: string): boolean {
  const [base = "", prefix = ""] = range.split("/");
  const network = parseAddress(base);
  if (!network || network.bits !== ip.bits) return false;
  const shift = BigInt(ip.bits - Number(prefix));
  return ip.value >> shift === network.value >> shift;
}

function parseAddress(text: string): Address | undefined {
  if (text.includes(":")) {
    const value = parseIpv6(text);
    return value === undefined ? undefined : { value, bits: 128 };
  }
  const value = parseIpv4(text);
  return value === undefined ? undefined : { value, bits: 32 };
}

function parseIpv4(text: string): bigint | undefined {
  const parts = text.split(".");
  if (parts.length !== 4) return undefined;
  let value = 0n;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part) || Number(part) > 255) return undefined;
    value = (value << 8n) | BigInt(part);
  }
  return value;
}

/** Eight groups of four hex digits; `::` stands for one or more zero groups. */
function parseIpv6(text: string): bigint | undefined {
  const halves = text.toLowerCase().split("::");
  if (halves.length > 2) return undefined;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const zeros = 8 - head.length - tail.length;
  if (halves.length === 1 ? zeros !== 0 : zeros < 1) return undefined;
  const groups = [...head, ...Array.from({ length: halves.length === 1 ? 0 : zeros }, () => "0"), ...tail];
  let value = 0n;
  for (const group of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(group)) return undefined;
    value = (value << 16n) | BigInt(Number.parseInt(group, 16));
  }
  return value;
}

/** Whether a POST opens an MCP session: an `initialize` request, alone or in a batch. */
async function isInitialize(request: Request): Promise<boolean> {
  try {
    const body = parseJson(await request.clone().text());
    return (Array.isArray(body) ? body : [body]).some((message) => asObject(message)?.method === "initialize");
  } catch {
    return false;
  }
}

/** A response body as text, refused past MAX_READ_BYTES so one read cannot exhaust the isolate. */
async function boundedText(response: Response, target: string): Promise<string> {
  const tooLarge = () => new Error(`${target} is larger than ${MAX_READ_BYTES / 1024 / 1024} MB; read it in pages with /records and nextCursor, or narrow it with where or bbox`);
  if (Number(response.headers.get("Content-Length")) > MAX_READ_BYTES) {
    await response.body?.cancel();
    throw tooLarge();
  }
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_READ_BYTES) {
      await reader.cancel();
      throw tooLarge();
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

/** The `detail` of an application/problem+json answer, if that is what came back. */
function problemDetail(text: string): string | undefined {
  try {
    return asString(asObject(parseJson(text))?.detail);
  } catch {
    return undefined;
  }
}
