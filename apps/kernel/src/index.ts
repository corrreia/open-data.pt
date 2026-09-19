import { WorkerEntrypoint } from "cloudflare:workers";
import { UsageRecorder, isOwnPageFetch, surfaceOf, type CacheOutcome, type McpCall } from "./analytics";
import { CADENCE_HEADER, cacheTtl, productTtl } from "./cache";
import { handleSite, type SiteHost } from "./discovery";
import { handleApi, problem, type ApiContext } from "./http";
import type { McpHost } from "./mcp";
import { openApiDocument, scalarReferenceHtml } from "./openapi";
import { R2SnapshotStore } from "./r2-snapshot-store";
import {
  ALLOWED_METHODS,
  GuardError,
  RATE_LIMIT_RETRY_SECONDS,
  canonicalRoute,
  isAllowedMethod,
  requestIdOf,
  withinRateLimit,
  type CanonicalRoute,
  type RateLimiters,
} from "./request-guard";

export { FeedRunner, Registry } from "./coordinators";
export { CollectionWorkflow } from "./workflow";

/** One MCP code run may page through a few history windows; past this it is stopped. */
const MCP_RUN_TIMEOUT_MS = 30_000;

/** A request's answer, with what the usage count needs to know about how it was answered. */
interface Served {
  response: Response;
  cache: CacheOutcome;
  mcp?: McpCall;
}

export default class KernelWorker extends WorkerEntrypoint<Env> {
  /** Answers the request, then counts it: one Analytics Engine data point, written without waiting. */
  override async fetch(request: Request): Promise<Response> {
    const started = Date.now();
    const url = new URL(request.url);
    const usage = new UsageRecorder(this.env.USAGE);
    const served = await this.serve(request, url, usage);
    const surface = surfaceOf(url);
    if (surface && request.method !== "OPTIONS" && !isOwnPageFetch(request)) {
      usage.record({ surface, url, request, response: served.response, durationMs: Date.now() - started, cache: served.cache, mcp: served.mcp });
    }
    return served.response;
  }

  private async serve(request: Request, url: URL, usage: UsageRecorder): Promise<Served> {
    if (url.pathname === "/openapi.json") {
      const response = Response.json(openApiDocument(url.origin), {
        headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
      });
      return { response, cache: "none" };
    }
    if (url.pathname === "/docs" || url.pathname === "/docs/") {
      const nonce = crypto.randomUUID().replaceAll("-", "");
      const response = new Response(scalarReferenceHtml(nonce), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; connect-src 'self' https://cdn.jsdelivr.net; base-uri 'none'; frame-ancestors 'none'`,
          "Cache-Control": "no-store",
        },
      });
      return { response, cache: "none" };
    }
    if (url.pathname === "/mcp") {
      const served: Served = { response: new Response(null), cache: "none" };
      try {
        // Loaded on first use: the MCP SDK and its schemas are most of the bundle, and API reads never need them.
        const { handleMcp } = await import("./mcp");
        served.response = await handleMcp(
          request,
          await this.mcpHost(request, usage, (call) => {
            served.mcp = call;
          }),
        );
      } catch (error) {
        const requestId = requestIdOf(request);
        console.error(JSON.stringify({ event: "mcp_request_failed", requestId, error: error instanceof Error ? error.message : String(error) }));
        served.response = problem(500, "Request failed", `Something went wrong on our side. Request ${requestId}.`, { "X-Request-Id": requestId });
      }
      return served;
    }
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") {
      try {
        return { response: await handleSite(request, this.siteHost(request)), cache: "none" };
      } catch (error) {
        const requestId = requestIdOf(request);
        console.error(JSON.stringify({ event: "site_request_failed", requestId, path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
        return { response: problem(500, "Request failed", `Something went wrong on our side. Request ${requestId}.`, { "X-Request-Id": requestId }), cache: "none" };
      }
    }
    try {
      return await this.api(request, url);
    } catch (error) {
      const requestId = requestIdOf(request);
      console.error(JSON.stringify({ event: "api_edge_failed", requestId, path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
      return { response: problem(500, "Request failed", `Something went wrong on our side. Request ${requestId}.`, { "X-Request-Id": requestId }), cache: "none" };
    }
  }

  /**
   * The read-only API behind the edge cache. The cache key is the route's
   * canonical URL, so unknown parameters are refused rather than cached apart,
   * and only requests that miss the cache count against the rate limits.
   */
  private async api(request: Request, url: URL): Promise<Served> {
    if (!isAllowedMethod(request.method)) {
      return { response: problem(405, "Method not allowed", "The API is read-only; use GET.", { Allow: ALLOWED_METHODS }), cache: "none" };
    }
    if (request.method === "OPTIONS") return { response: await handleApi(request, this.apiContext()), cache: "none" };
    let route: CanonicalRoute | undefined;
    try {
      route = canonicalRoute(url);
    } catch (error) {
      if (error instanceof GuardError) return { response: problem(error.status, error.title, error.message), cache: "none" };
      throw error;
    }
    const head = request.method === "HEAD";
    const target = route?.url ?? url;
    const read = new Request(target, { method: "GET", headers: request.headers });
    const ttl = route ? cacheTtl(target) : undefined;
    if (ttl !== undefined) {
      const hit = await caches.default.match(read);
      if (hit) return { response: head ? withoutBody(hit) : hit, cache: "hit" };
    }
    const cache = ttl === undefined ? "none" : "miss";
    if (!(await withinRateLimit(this.rateLimiters(), request, route?.costly === true))) {
      const response = problem(429, "Too many requests", `This client sent too many uncached requests; retry after ${RATE_LIMIT_RETRY_SECONDS} seconds.`, {
        "Retry-After": String(RATE_LIMIT_RETRY_SECONDS),
      });
      return { response, cache };
    }
    const response = await handleApi(read, this.apiContext());
    if (ttl === undefined || !response.ok) return { response: head ? withoutBody(response) : response, cache };

    const cacheable = new Response(response.body, response);
    // A product's current data names its cadence, so one that changes daily is not read again every 15 seconds.
    const cadence = cacheable.headers.get(CADENCE_HEADER);
    cacheable.headers.delete(CADENCE_HEADER);
    const lifetime = productTtl(ttl, cadence === null ? undefined : Number(cadence));
    cacheable.headers.set("Cache-Control", `public, max-age=${lifetime}, stale-while-revalidate=${lifetime}`);
    this.ctx.waitUntil(caches.default.put(read, cacheable.clone()));
    return { response: head ? withoutBody(cacheable) : cacheable, cache };
  }

  protected apiContext(): ApiContext {
    return { env: this.env, snapshots: new R2SnapshotStore(this.env.DATA_OBJECTS) };
  }

  /** The Workers Rate Limiting bindings; tests and local runs may have none. */
  protected rateLimiters(): RateLimiters {
    return { api: this.env.API_RATE_LIMIT, costly: this.env.HISTORY_RATE_LIMIT };
  }

  /**
   * What the pages and discovery documents read: the API as the visitor would,
   * through the same edge cache and rate limits, and the site's own files.
   */
  protected siteHost(request: Request): SiteHost {
    const origin = new URL(request.url).origin;
    const headers = new Headers({ Accept: "application/json" });
    const client = request.headers.get("cf-connecting-ip");
    if (client) headers.set("cf-connecting-ip", client);
    return {
      api: async (path) => {
        const url = new URL(path, origin);
        return (await this.api(new Request(url, { headers }), url)).response;
      },
      assets: async (asset) => this.env.ASSETS.fetch(asset),
    };
  }

  /**
   * What /mcp runs on: a Dynamic Worker per code run, cut off from the network,
   * reading the API through the same cache and rate limits as any client. Each
   * read is counted as the MCP client's, so the page can say what assistants read.
   */
  protected async mcpHost(request: Request, usage: UsageRecorder, onCall: (call: McpCall) => void): Promise<McpHost> {
    const [{ DynamicWorkerExecutor }, { limitRuns, mcpClientKey }] = await Promise.all([import("@cloudflare/codemode"), import("./mcp")]);
    const key = mcpClientKey(request);
    const limiter = this.env.MCP_RATE_LIMIT;
    const executor = new DynamicWorkerExecutor({ loader: this.env.LOADER, timeout: MCP_RUN_TIMEOUT_MS });
    return {
      executor: limitRuns(executor, async () => (await limiter.limit({ key })).success),
      read: async (read) => {
        const started = Date.now();
        const url = new URL(read.url);
        const served = await this.api(read, url);
        usage.record({ surface: "mcp-read", url, request, response: served.response, durationMs: Date.now() - started, cache: served.cache });
        return served.response;
      },
      clientKey: key,
      onCall,
    };
  }
}

/** A HEAD answer: the GET response's status and headers without its body. */
function withoutBody(response: Response): Response {
  return new Response(null, response);
}
