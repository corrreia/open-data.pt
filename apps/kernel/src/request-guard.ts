/**
 * The edge in front of the read-only API: which query parameters each route
 * accepts, the canonical URL its cache entry is stored under, and per-client
 * rate limits. Accepting only known parameters means a made-up one cannot
 * create a fresh cache entry, so every repeated read is served from the edge.
 */

/** One public read route and the query parameters it accepts. */
interface RouteRule {
  pattern: RegExp;
  params: readonly string[];
  /** Parameters that may appear more than once (record filters). */
  repeatable?: readonly string[];
  /** Routes that scan the lake or stream a whole product get the stricter limit. */
  costly?: boolean;
}

const HISTORY_WINDOW = ["from", "to", "cursor", "limit"] as const;

/** First match wins: the GeoJSON and history routes come before the plain product route. */
const ROUTES: readonly RouteRule[] = [
  { pattern: /^\/api\/?$/, params: [] },
  { pattern: /^\/api\/(health|products|feeds|catalog\.dcat\.json)$/, params: [] },
  { pattern: /^\/api\/outages$/, params: ["days"] },
  { pattern: /^\/api\/acquisitions$/, params: ["day", "feedId", "limit"] },
  { pattern: /^\/api\/feeds\/[^/]+$/, params: [] },
  { pattern: /^\/api\/products\/[^/]+\.geojson$/, params: ["where", "bbox"], repeatable: ["where"], costly: true },
  { pattern: /^\/api\/products\/[^/]+\/records\/all$/, params: ["where", "bbox"], repeatable: ["where"], costly: true },
  { pattern: /^\/api\/products\/[^/]+\/records$/, params: ["limit", "cursor", "validAt", "where", "bbox"], repeatable: ["where"] },
  { pattern: /^\/api\/products\/[^/]+\/changes$/, params: ["knownAt", "limit"] },
  { pattern: /^\/api\/products\/[^/]+\/(series|series\/changes)$/, params: ["seriesKey", "from", "to", "limit"] },
  { pattern: /^\/api\/products\/[^/]+\/events$/, params: [...HISTORY_WINDOW, "knownAt"], costly: true },
  { pattern: /^\/api\/products\/[^/]+\/changes\/range$/, params: [...HISTORY_WINDOW, "seriesKey"], costly: true },
  // Summaries are read from R2 alone, never the lake, so they are not costly.
  { pattern: /^\/api\/products\/[^/]+\/series\/summary$/, params: ["from", "to", "resolution", "seriesKey"], repeatable: ["seriesKey"] },
  { pattern: /^\/api\/products\/[^/]+\/series\/summary\/\d{4}-\d{2}$/, params: [] },
  { pattern: /^\/api\/products\/[^/]+\/series\/range$/, params: [...HISTORY_WINDOW, "knownAt", "seriesKey"], costly: true },
  { pattern: /^\/api\/products\/[^/]+\/series\/changes\/range$/, params: [...HISTORY_WINDOW, "seriesKey"], costly: true },
  { pattern: /^\/api\/products\/[^/]+$/, params: [] },
];

/** At most this many `where` filters on one request. */
export const MAX_FILTERS = 5;

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

/** A route's canonical URL, and whether it counts against the stricter limit. */
export interface CanonicalRoute {
  url: URL;
  costly: boolean;
}

/**
 * The canonical URL of a known read route: its path and its accepted
 * parameters, sorted. Unknown or repeated parameters are a client error.
 * Returns undefined for a path no route matches, which the API answers 404.
 */
export function canonicalRoute(url: URL): CanonicalRoute | undefined {
  const rule = ROUTES.find((candidate) => candidate.pattern.test(url.pathname));
  if (!rule) return undefined;
  const accepted = new Set(rule.params);
  const repeatable = new Set(rule.repeatable ?? []);
  const seen = new Map<string, string[]>();
  for (const [name, value] of url.searchParams) {
    if (!accepted.has(name)) {
      const allowed = rule.params.length === 0 ? "no query parameters" : rule.params.join(", ");
      throw new GuardError(`Unknown query parameter "${name}"; this endpoint accepts ${allowed}`, 400, "Invalid request");
    }
    const values = seen.get(name) ?? [];
    if (values.length > 0 && !repeatable.has(name)) throw new GuardError(`Query parameter "${name}" may appear only once`, 400, "Invalid request");
    values.push(value);
    seen.set(name, values);
  }
  if ((seen.get("where")?.length ?? 0) > MAX_FILTERS) throw new GuardError(`At most ${MAX_FILTERS} where filters are allowed`, 400, "Invalid request");
  const canonical = new URL(url.pathname, url.origin);
  for (const name of [...seen.keys()].sort()) {
    for (const value of [...seen.get(name)!].sort()) canonical.searchParams.append(name, value);
  }
  return { url: canonical, costly: rule.costly === true };
}

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

/**
 * Whether this client may make one more uncached request. Keyed on the client
 * IP; history and GeoJSON also count against the stricter limit.
 */
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
