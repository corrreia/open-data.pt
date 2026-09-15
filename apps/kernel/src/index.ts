import { WorkerEntrypoint } from "cloudflare:workers";
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

export default class KernelWorker extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/openapi.json") {
      return Response.json(openApiDocument(url.origin), {
        headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" },
      });
    }
    if (url.pathname === "/docs" || url.pathname === "/docs/") {
      const nonce = crypto.randomUUID().replaceAll("-", "");
      return new Response(scalarReferenceHtml(nonce), {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
          "Content-Security-Policy": `default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data: https:; font-src data: https:; connect-src 'self' https://cdn.jsdelivr.net; base-uri 'none'; frame-ancestors 'none'`,
          "Cache-Control": "no-store",
        },
      });
    }
    if (url.pathname === "/mcp") {
      try {
        // Loaded on first use: the MCP SDK and its schemas are most of the bundle, and API reads never need them.
        const { handleMcp } = await import("./mcp");
        return await handleMcp(request, await this.mcpHost(request));
      } catch (error) {
        const requestId = requestIdOf(request);
        console.error(JSON.stringify({ event: "mcp_request_failed", requestId, error: error instanceof Error ? error.message : String(error) }));
        return problem(500, "Request failed", `Something went wrong on our side. Request ${requestId}.`, { "X-Request-Id": requestId });
      }
    }
    if (!url.pathname.startsWith("/api/") && url.pathname !== "/api") {
      try {
        return await handleSite(request, this.siteHost(request));
      } catch (error) {
        const requestId = requestIdOf(request);
        console.error(JSON.stringify({ event: "site_request_failed", requestId, path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
        return problem(500, "Request failed", `Something went wrong on our side. Request ${requestId}.`, { "X-Request-Id": requestId });
      }
    }
    try {
      return await this.api(request, url);
    } catch (error) {
      const requestId = requestIdOf(request);
      console.error(JSON.stringify({ event: "api_edge_failed", requestId, path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
      return problem(500, "Request failed", `Something went wrong on our side. Request ${requestId}.`, { "X-Request-Id": requestId });
    }
  }

  /**
   * The read-only API behind the edge cache. The cache key is the route's
   * canonical URL, so unknown parameters are refused rather than cached apart,
   * and only requests that miss the cache count against the rate limits.
   */
  private async api(request: Request, url: URL): Promise<Response> {
    if (!isAllowedMethod(request.method)) {
      return problem(405, "Method not allowed", "The API is read-only; use GET.", { Allow: ALLOWED_METHODS });
    }
    if (request.method === "OPTIONS") return handleApi(request, this.apiContext());
    let route: CanonicalRoute | undefined;
    try {
      route = canonicalRoute(url);
    } catch (error) {
      if (error instanceof GuardError) return problem(error.status, error.title, error.message);
      throw error;
    }
    const head = request.method === "HEAD";
    const target = route?.url ?? url;
    const read = new Request(target, { method: "GET", headers: request.headers });
    const ttl = route ? cacheTtl(target) : undefined;
    const cache = caches.default;
    if (ttl !== undefined) {
      const hit = await cache.match(read);
      if (hit) return head ? withoutBody(hit) : hit;
    }
    if (!(await withinRateLimit(this.rateLimiters(), request, route?.costly === true))) {
      return problem(429, "Too many requests", `This client sent too many uncached requests; retry after ${RATE_LIMIT_RETRY_SECONDS} seconds.`, { "Retry-After": String(RATE_LIMIT_RETRY_SECONDS) });
    }
    const response = await handleApi(read, this.apiContext());
    if (ttl === undefined || !response.ok) return head ? withoutBody(response) : response;

    const cacheable = new Response(response.body, response);
    // A product's current data names its cadence, so one that changes daily is not read again every 15 seconds.
    const cadence = cacheable.headers.get(CADENCE_HEADER);
    cacheable.headers.delete(CADENCE_HEADER);
    const lifetime = productTtl(ttl, cadence === null ? undefined : Number(cadence));
    cacheable.headers.set("Cache-Control", `public, max-age=${lifetime}, stale-while-revalidate=${lifetime}`);
    this.ctx.waitUntil(cache.put(read, cacheable.clone()));
    return head ? withoutBody(cacheable) : cacheable;
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
        return this.api(new Request(url, { headers }), url);
      },
      assets: async (asset) => this.env.ASSETS.fetch(asset),
    };
  }

  /**
   * What /mcp runs on: a Dynamic Worker per code run, cut off from the network,
   * reading the API through the same cache and rate limits as any client.
   */
  protected async mcpHost(request: Request): Promise<McpHost> {
    const [{ DynamicWorkerExecutor }, { limitRuns, mcpClientKey }] = await Promise.all([import("@cloudflare/codemode"), import("./mcp")]);
    const key = mcpClientKey(request);
    const limiter = this.env.MCP_RATE_LIMIT;
    const executor = new DynamicWorkerExecutor({ loader: this.env.LOADER, timeout: MCP_RUN_TIMEOUT_MS });
    return {
      executor: limitRuns(executor, async () => (await limiter.limit({ key })).success),
      read: async (read) => this.api(read, new URL(read.url)),
      clientKey: key,
    };
  }
}

/** A HEAD answer: the GET response's status and headers without its body. */
function withoutBody(response: Response): Response {
  return new Response(null, response);
}
