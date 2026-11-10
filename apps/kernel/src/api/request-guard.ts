import { MAX_FILTERS, apiRouteAt } from "@open-data-pt/api";

/** A request the edge refuses before any work: an unknown parameter, a disallowed method. */
export class GuardError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly title: string,
  ) {
    super(message);
    this.name = "GuardError";
  }
}

/** A route's canonical URL, its OpenAPI name, and whether it counts against the stricter limit. */
export interface CanonicalRoute {
  url: URL;
  template: string;
  costly: boolean;
}

/** The OpenAPI name of the route a path would take, without checking its parameters. */
export function routeTemplate(pathname: string): string | undefined {
  return apiRouteAt(pathname)?.path;
}

/**
 * The canonical URL of a known read route: its path and accepted parameters,
 * sorted. Unknown or repeated parameters are a client error.
 */
export function canonicalRoute(url: URL): CanonicalRoute | undefined {
  const route = apiRouteAt(url.pathname);
  if (!route) return undefined;
  const definitions = new Map(route.query.map((parameter) => [parameter.name, parameter]));
  const seen = new Map<string, string[]>();
  for (const [name, value] of url.searchParams) {
    const definition = definitions.get(name);
    if (!definition) {
      const allowed = route.query.length === 0 ? "no query parameters" : route.query.map((parameter) => parameter.name).join(", ");
      throw new GuardError(`Unknown query parameter "${name}"; this endpoint accepts ${allowed}`, 400, "Invalid request");
    }
    const values = seen.get(name) ?? [];
    if (values.length > 0 && definition.repeatable !== true) throw new GuardError(`Query parameter "${name}" may appear only once`, 400, "Invalid request");
    values.push(value);
    seen.set(name, values);
  }
  if ((seen.get("where")?.length ?? 0) > MAX_FILTERS) throw new GuardError(`At most ${MAX_FILTERS} where filters are allowed`, 400, "Invalid request");
  const canonical = new URL(url.pathname, url.origin);
  for (const name of [...seen.keys()].sort()) {
    for (const value of [...(seen.get(name) ?? [])].sort()) canonical.searchParams.append(name, value);
  }
  const scans = route.costlyWith?.some((name) => seen.has(name)) === true;
  return { url: canonical, template: route.path, costly: route.costly === true || scans };
}

export { MAX_FILTERS };

/** The request methods the read-only API answers; everything else is 405. */
export const ALLOWED_METHODS = "GET, HEAD, OPTIONS";

export function isAllowedMethod(method: string): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

/** Rate limiters bound in wrangler.jsonc; absent in tests and local runs. */
export interface RateLimiters {
  api?: RateLimit;
  costly?: RateLimit;
}

/** Seconds a client is told to wait after a 429: the rate-limit period. */
export const RATE_LIMIT_RETRY_SECONDS = 60;

/** Whether this client may make one more uncached request. */
export async function withinRateLimit(limiters: RateLimiters, request: Request, costly: boolean): Promise<boolean> {
  const key = request.headers.get("cf-connecting-ip") ?? "anonymous";
  if (limiters.api && !(await limiters.api.limit({ key })).success) return false;
  if (costly && limiters.costly && !(await limiters.costly.limit({ key })).success) return false;
  return true;
}

/** An identifier a client can quote when reporting a failed request. */
export function requestIdOf(request: Request): string {
  return request.headers.get("cf-ray") ?? crypto.randomUUID();
}
