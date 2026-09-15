/**
 * Public read endpoints that are safe to cache at the edge. Caching them keeps
 * object reads, Durable Object requests and lake scans flat no matter how many
 * clients poll; the freshness cost is at most the listed number of seconds.
 */
const CACHE_TTL_SECONDS: Array<[pattern: RegExp, seconds: number]> = [
  [/^\/api\/products\/[^/]+\.geojson$/, 15],
  [/^\/api\/products\/[^/]+\/records\/all$/, 15],
  [/^\/api\/products\/[^/]+\/(records|series|changes|series\/changes)$/, 15],
  [/^\/api\/products(\/[^/]+)?$/, 20],
  [/^\/api\/(feeds|acquisitions)$/, 10],
  [/^\/api\/feeds\/[^/]+$/, 10],
  [/^\/api\/catalog\.dcat\.json$/, 300],
];

const HISTORY_PATH = /^\/api\/products\/[^/]+\/(events|changes\/range|series\/range|series\/changes\/range)$/;
/** A window that ended over an hour ago only changes if a backfill or late correction lands in it. */
const SETTLED_AFTER_MS = 60 * 60_000;

/** History windows entirely in the settled past are cached for a day; everything else briefly. */
export function cacheTtl(url: URL, now = Date.now()): number | undefined {
  if (HISTORY_PATH.test(url.pathname)) {
    const to = Date.parse(url.searchParams.get("to") ?? "");
    const knownAt = url.searchParams.get("knownAt");
    const settled = Number.isFinite(to) && to < now - SETTLED_AFTER_MS && (knownAt === null || Date.parse(knownAt) < now - SETTLED_AFTER_MS);
    return settled ? 86_400 : 300;
  }
  // A past day of runs comes from a mirror that only grows at its newest end.
  if (url.pathname === "/api/acquisitions" && url.searchParams.has("day")) return 300;
  return CACHE_TTL_SECONDS.find(([pattern]) => pattern.test(url.pathname))?.[1];
}

/** A product's current-data responses name its feed's cadence in this header; the edge reads and removes it. */
export const CADENCE_HEADER = "X-Open-Data-Cadence";
/** However rarely a product changes, the edge reads it again within five minutes. */
const MAX_PRODUCT_TTL_SECONDS = 300;

/**
 * How long the edge keeps a product's current data: a quarter of its cadence,
 * never less than the route's own lifetime and never more than five minutes.
 * A minute-cadence feed stays near real time; a daily one is not read again
 * every 15 seconds.
 */
export function productTtl(routeTtl: number, cadenceSeconds: number | undefined): number {
  if (cadenceSeconds === undefined || !Number.isFinite(cadenceSeconds) || cadenceSeconds <= 0) return routeTtl;
  return Math.min(MAX_PRODUCT_TTL_SECONDS, Math.max(routeTtl, Math.floor(cadenceSeconds / 4)));
}
