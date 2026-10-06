/**
 * The edge in front of the read-only API: which query parameters each route
 * accepts, the canonical URL its cache entry is stored under, and per-client
 * rate limits. Accepting only known parameters means a made-up one cannot
 * create a fresh cache entry, so every repeated read is served from the edge.
 */

/** One public read route and the query parameters it accepts. */
interface RouteRule {
  pattern: RegExp;
  /** The route as the OpenAPI document names it, such as /api/products/{slug}/records. */
  template: string;
  params: readonly string[];
  /** Parameters that may appear more than once (record filters). */
  repeatable?: readonly string[];
  /** Routes that scan the lake or stream a whole product get the stricter limit. */
  costly?: boolean;
  /** Parameters that make a request scan on through a product, and so count it against the stricter limit too. */
  costlyWith?: readonly string[];
  /** Coordinates, rounded in the cache key to five decimals (about a metre), so a point clicked twice is one entry. */
  coordinates?: readonly string[];
}

const POINT = ["lat", "lon"] as const;
/** The point filter on a product's rows: where, and how far around it. */
const AT_POINT = [...POINT, "radius"] as const;

const HISTORY_WINDOW = ["from", "to", "cursor", "limit"] as const;

/** First match wins: the GeoJSON and history routes come before the plain product route. */
const ROUTES: readonly RouteRule[] = [
  { pattern: /^\/api\/?$/, template: "/api", params: [] },
  { pattern: /^\/api\/health$/, template: "/api/health", params: [] },
  // With a point, the products whose extent reaches it: the product index alone, no record read.
  { pattern: /^\/api\/products$/, template: "/api/products", params: [...POINT, "radius"], coordinates: POINT },
  { pattern: /^\/api\/feeds$/, template: "/api/feeds", params: [] },
  { pattern: /^\/api\/catalog\.dcat\.json$/, template: "/api/catalog.dcat.json", params: [] },
  { pattern: /^\/api\/outages$/, template: "/api/outages", params: ["days"] },
  { pattern: /^\/api\/analytics$/, template: "/api/analytics", params: ["days"] },
  { pattern: /^\/api\/acquisitions$/, template: "/api/acquisitions", params: ["day", "feedId", "limit"] },
  { pattern: /^\/api\/feeds\/[^/]+$/, template: "/api/feeds/{feedId}", params: [] },
  {
    pattern: /^\/api\/products\/[^/]+\.geojson$/,
    template: "/api/products/{slug}.geojson",
    params: ["where", "bbox", ...AT_POINT],
    repeatable: ["where"],
    coordinates: POINT,
    costly: true,
  },
  { pattern: /^\/api\/products\/[^/]+\/records\/all$/, template: "/api/products/{slug}/records/all", params: ["where", "bbox"], repeatable: ["where"], costly: true },
  {
    pattern: /^\/api\/products\/[^/]+\/records$/,
    template: "/api/products/{slug}/records",
    params: ["limit", "cursor", "validAt", "where", "bbox", ...AT_POINT],
    repeatable: ["where"],
    coordinates: POINT,
    // A filtered page reads on until it fills, up to a few hundred chunks: much of a product, as /records/all reads all of it.
    // A point reads only the chunks whose box reaches it, but up to POINT_LOOKUP.maxChunks of them, so it counts the same.
    costlyWith: ["validAt", "where", "bbox", ...POINT],
  },
  { pattern: /^\/api\/products\/[^/]+\/changes$/, template: "/api/products/{slug}/changes", params: ["knownAt", "limit"] },
  { pattern: /^\/api\/products\/[^/]+\/series$/, template: "/api/products/{slug}/series", params: ["seriesKey", "from", "to", "limit"] },
  { pattern: /^\/api\/products\/[^/]+\/series\/changes$/, template: "/api/products/{slug}/series/changes", params: ["seriesKey", "from", "to", "limit"] },
  { pattern: /^\/api\/products\/[^/]+\/events$/, template: "/api/products/{slug}/events", params: [...HISTORY_WINDOW, "knownAt"], costly: true },
  { pattern: /^\/api\/products\/[^/]+\/changes\/range$/, template: "/api/products/{slug}/changes/range", params: [...HISTORY_WINDOW, "seriesKey"], costly: true },
  // Summaries are read from R2 alone, never the lake, so they are not costly.
  {
    pattern: /^\/api\/products\/[^/]+\/series\/summary$/,
    template: "/api/products/{slug}/series/summary",
    params: ["from", "to", "resolution", "seriesKey"],
    repeatable: ["seriesKey"],
  },
  { pattern: /^\/api\/products\/[^/]+\/series\/summary\/\d{4}(?:-\d{2})?$/, template: "/api/products/{slug}/series/summary/{period}", params: [] },
  { pattern: /^\/api\/products\/[^/]+\/series\/range$/, template: "/api/products/{slug}/series/range", params: [...HISTORY_WINDOW, "knownAt", "seriesKey"], costly: true },
  { pattern: /^\/api\/products\/[^/]+\/series\/changes\/range$/, template: "/api/products/{slug}/series/changes/range", params: [...HISTORY_WINDOW, "seriesKey"], costly: true },
  { pattern: /^\/api\/products\/[^/]+$/, template: "/api/products/{slug}", params: [] },
];

/** The OpenAPI name of the route a path would take, without checking its parameters; undefined for a path no route matches. */
export function routeTemplate(pathname: string): string | undefined {
  return ROUTES.find((candidate) => candidate.pattern.test(pathname))?.template;
}

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

/** A route's canonical URL, its OpenAPI name, and whether it counts against the stricter limit. */
export interface CanonicalRoute {
  url: URL;
  template: string;
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
  const coordinates = new Set(rule.coordinates ?? []);
  for (const name of [...seen.keys()].sort()) {
    for (const value of [...seen.get(name)!].sort()) canonical.searchParams.append(name, coordinates.has(name) ? roundedCoordinate(value) : value);
  }
  const scans = rule.costlyWith?.some((name) => seen.has(name)) === true;
  return { url: canonical, template: rule.template, costly: rule.costly === true || scans };
}

/**
 * A coordinate at five decimals, about 1.1 m of latitude: finer than any
 * source here places a parcel boundary, and coarse enough that the same
 * point asked twice (or written with more digits) is one cache entry. What
 * is not a number is left as it is, for the API to refuse.
 */
function roundedCoordinate(value: string): string {
  const number = Number(value.trim());
  if (value.trim() === "" || !Number.isFinite(number)) return value;
  return String(Math.round(number * 1e5) / 1e5 || 0);
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
 * IP; history, GeoJSON and filtered record pages also count against the stricter limit.
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
