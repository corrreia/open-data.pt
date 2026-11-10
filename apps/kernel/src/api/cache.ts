import { apiRouteAt } from "@open-data-pt/api";

/** A window that ended over an hour ago only changes if late history lands. */
const SETTLED_AFTER_MS = 60 * 60_000;
/** Summaries gain a day once that day is a day old. */
const SUMMARY_SETTLED_AFTER_MS = 2 * 86_400_000;

/** Cache lifetime from the route contract and the request's time window. */
export function cacheTtl(url: URL, now = Date.now()): number | undefined {
  const policy = apiRouteAt(url.pathname)?.cache;
  if (!policy || policy.kind === "none") return undefined;
  if (policy.kind === "fixed" || policy.kind === "current-product") return policy.seconds;
  if (policy.kind === "acquisitions") return url.searchParams.has("day") ? 300 : 10;
  if (policy.kind === "summary-file") {
    const period = /\/(\d{4})(?:-(\d{2}))?$/.exec(url.pathname);
    if (!period) return 3_600;
    const year = Number(period[1]);
    const end = period[2] ? Date.UTC(year, Number(period[2]), 1) : Date.UTC(year + 1, 0, 1);
    return end + SUMMARY_SETTLED_AFTER_MS < now ? 86_400 : 3_600;
  }
  if (policy.kind === "summary") {
    const to = Date.parse(url.searchParams.get("to") ?? "");
    return Number.isFinite(to) && to < now - SUMMARY_SETTLED_AFTER_MS ? 86_400 : 3_600;
  }
  const to = Date.parse(url.searchParams.get("to") ?? "");
  const knownAt = url.searchParams.get("knownAt");
  const settled = Number.isFinite(to) && to < now - SETTLED_AFTER_MS && (knownAt === null || Date.parse(knownAt) < now - SETTLED_AFTER_MS);
  return settled ? 86_400 : 300;
}

/** A product's current-data responses name their cadence for the cached entrypoint. */
export const CADENCE_HEADER = "X-Open-Data-Cadence";
/** However rarely a product changes, the edge reads it again within five minutes. */
const MAX_PRODUCT_TTL_SECONDS = 300;

/** A quarter of cadence, bounded by the route lifetime and five minutes. */
export function productTtl(routeTtl: number, cadenceSeconds: number | undefined): number {
  if (cadenceSeconds === undefined || !Number.isFinite(cadenceSeconds) || cadenceSeconds <= 0) return routeTtl;
  return Math.min(MAX_PRODUCT_TTL_SECONDS, Math.max(routeTtl, Math.floor(cadenceSeconds / 4)));
}
