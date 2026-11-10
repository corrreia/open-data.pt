import { WorkerEntrypoint } from "cloudflare:workers";
import { OPENAPI_MEDIA_TYPE } from "@open-data-pt/api";
import { UsageRecorder, askCallOf, countedSurface, type AskCall, type CacheOutcome, type McpCall } from "#/pages/analytics";
import { CADENCE_HEADER, cacheTtl, productTtl } from "#/api/cache";
import { handleSite, type SiteHost } from "#/pages/discovery";
import { handleAsk, isAskRoute } from "#/ask/ask";
import { handleApi, problem, type ApiContext } from "#/api/http";
import type { McpHost } from "#/api/mcp";
import { openApiDocument, scalarReferenceHtml } from "#/api/openapi";
import { R2SnapshotStore } from "#/serving/r2-snapshot-store";
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
} from "#/api/request-guard";

export { Registry } from "#/registry/registry";
export { FeedRunner } from "#/runner/feed-runner";
export { CollectionWorkflow } from "#/collection/workflow";

/** One MCP code run may page through a few history windows; past this it is stopped. */
const MCP_RUN_TIMEOUT_MS = 30_000;

/** A request's answer, with what the usage count needs to know about how it was answered. */
interface Served {
  response: Response;
  cache: CacheOutcome;
  mcp?: McpCall;
  ask?: AskCall;
}

export default class KernelWorker extends WorkerEntrypoint<Env> {
  /** Answers the request, then counts it: one Analytics Engine data point, written without waiting. */
  override async fetch(request: Request): Promise<Response> {
    const started = Date.now();
    const url = new URL(request.url);
    const usage = new UsageRecorder(this.env.USAGE);
    const served = await this.serve(request, url, usage);
    const surface = countedSurface(request, url, served.ask);
    if (surface) usage.record({ surface, url, request, response: served.response, durationMs: Date.now() - started, cache: served.cache, mcp: served.mcp, ask: served.ask });
    return served.response;
  }

  private async serve(request: Request, url: URL, usage: UsageRecorder): Promise<Served> {
    if (url.pathname === "/openapi.json") {
      const response = new Response(JSON.stringify(openApiDocument(url.origin)), {
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "public, max-age=300",
          "Content-Type": OPENAPI_MEDIA_TYPE,
        },
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
        const { handleMcp } = await import("#/api/mcp");
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
    if (isAskRoute(url.pathname)) {
      const served: Served = { response: new Response(null), cache: "none" };
      try {
        served.response = await handleAsk(request, {
          clientId: this.env.ASK_OAUTH_CLIENT_ID,
          fetch: (input, init) => fetch(input, init),
          now: Date.now,
          onChat: (model, messages) => {
            served.ask = askCallOf(model, messages);
          },
        });
        return served;
      } catch (error) {
        const requestId = requestIdOf(request);
        console.error(JSON.stringify({ event: "ask_request_failed", requestId, path: url.pathname, error: error instanceof Error ? error.message : String(error) }));
        served.response = problem(500, "Request failed", `Something went wrong on our side. Request ${requestId}.`, { "X-Request-Id": requestId });
        return served;
      }
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
   * The uncached gateway: method and query guards stay here, then cacheable GETs
   * cross the named CachedApi entrypoint whose platform cache collapses misses.
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
      const response = await this.ctx.exports.CachedApi.fetch(read);
      const status = response.headers.get("CF-Cache-Status")?.toLowerCase();
      const cache: CacheOutcome = status === "hit" ? "hit" : "miss";
      return { response: head ? withoutBody(response) : response, cache };
    }
    if (!(await withinRateLimit(this.rateLimiters(), request, route?.costly === true))) {
      const response = problem(429, "Too many requests", `This client sent too many uncached requests; retry after ${RATE_LIMIT_RETRY_SECONDS} seconds.`, {
        "Retry-After": String(RATE_LIMIT_RETRY_SECONDS),
      });
      return { response, cache: "none" };
    }
    const response = await handleApi(read, this.apiContext());
    return { response: head ? withoutBody(response) : response, cache: "none" };
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
    const [{ DynamicWorkerExecutor }, { limitRuns, mcpClientKey }] = await Promise.all([import("@cloudflare/codemode"), import("#/api/mcp")]);
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

/**
 * The only cache-enabled entrypoint. Cloudflare applies its documented Worker
 * cache before invoking this handler, so only misses generate an API response
 * and consume a rate-limit token. Wrangler accepts and routes this locally but
 * does not simulate hits; production hit and miss-collapse behaviour remains
 * an explicit verification gap in docs/api.md.
 */
export class CachedApi extends WorkerEntrypoint<Env> {
  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const route = canonicalRoute(url);
    if (!(await withinRateLimit(this.rateLimiters(), request, route?.costly === true))) {
      return problem(429, "Too many requests", `This client sent too many uncached requests; retry after ${RATE_LIMIT_RETRY_SECONDS} seconds.`, {
        "Retry-After": String(RATE_LIMIT_RETRY_SECONDS),
      });
    }
    const response = await handleApi(request, this.apiContext());
    const ttl = cacheTtl(url);
    if (ttl === undefined || response.status !== 200) return response;
    const cacheable = new Response(response.body, response);
    const cadence = cacheable.headers.get(CADENCE_HEADER);
    cacheable.headers.delete(CADENCE_HEADER);
    const lifetime = productTtl(ttl, cadence === null ? undefined : Number(cadence));
    cacheable.headers.set("Cache-Control", `public, max-age=${lifetime}`);
    return cacheable;
  }

  protected apiContext(): ApiContext {
    return { env: this.env, snapshots: new R2SnapshotStore(this.env.DATA_OBJECTS) };
  }

  protected rateLimiters(): RateLimiters {
    return { api: this.env.API_RATE_LIMIT, costly: this.env.HISTORY_RATE_LIMIT };
  }
}

/** A HEAD answer: the GET response's status and headers without its body. */
function withoutBody(response: Response): Response {
  return new Response(null, response);
}
