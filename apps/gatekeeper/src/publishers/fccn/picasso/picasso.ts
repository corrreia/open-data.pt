import { GatekeeperError, fixedOrigin, readBoundedResponse, retryAfterSeconds, type FeedKindDescription, type SourceConfig, type SourceFetch } from "#/index";

/**
 * Picasso, FCCN's network statistics service, which draws the GigaPIX traffic charts on gigapix.pt. Each chart is an
 * iframe whose script reads `/api/data/query?db=…&q=gigapix&m=…&p=`, a keyless JSON answer shaped like an InfluxDB
 * query's: one series named `gigapix`, a `time` column in UTC and one value column in bits per second (the chart's
 * own `unit: "bps"`). The answer is the chart's whole window, ending with the bucket still being filled; it carries
 * no ETag or Last-Modified. Neither the page nor the chart says what `sum` adds up, or in which direction.
 */
export const PICASSO_ORIGIN = "https://picasso.netop.fccn.pt";
/** What the product pages link to: the GigaPIX statistics page those charts are drawn on. */
export const GIGAPIX_STATISTICS_PAGE = "https://gigapix.pt/en/technical/estatisticas-de-trafego/";
/** A year of days is about 16 KB, a day of five minutes about 13 KB. */
export const PICASSO_MAX_BYTES = 256 * 1024;

/** One chart Picasso draws for GigaPIX, by its `m` parameter: where it is kept, which column it answers, and its step. */
export interface PicassoChart {
  database: string;
  column: string;
  stepSeconds: number;
  /** More points than the window holds: a longer answer is a source that changed shape. */
  maxPoints: number;
  productKey: string;
  /** What each value is, as the series' only dimension. */
  statistic: string;
}

export const PICASSO_CHARTS: ReadonlyMap<string, PicassoChart> = new Map([
  // The yearly chart: 366 UTC days, each the day's maximum (`sum_max`), the last one still under way.
  ["yearly", { database: "ixp-hist", column: "sum_max", stepSeconds: 86_400, maxPoints: 400, productKey: "daily-peak", statistic: "daily maximum" }],
  // The daily chart: 288 five-minute means (`sum_mean`) over the last 24 hours, the last one still under way.
  ["daily", { database: "ixp", column: "sum_mean", stepSeconds: 300, maxPoints: 320, productKey: "traffic", statistic: "5-minute mean" }],
]);

export const PICASSO_FEEDS = {
  // Traffic through GigaPIX in bits per second, one chart of FCCN's statistics.
  traffic: {
    kind: "traffic",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
  },
} as const satisfies Record<string, FeedKindDescription>;

/** A Picasso feed's configuration: which chart it reads. Picasso answers for GigaPIX only, so nothing else is named. */
export function validatePicassoFeedConfig(config: SourceConfig): SourceConfig {
  for (const key of Object.keys(config))
    if (key !== "mode") throw new GatekeeperError(`Unsupported Picasso field: ${key}`, key === "host" || key === "url" ? "source-denied" : "invalid-config");
  const mode = config.mode?.trim() ?? "";
  if (!PICASSO_CHARTS.has(mode)) throw new GatekeeperError(`Picasso feeds read mode=${[...PICASSO_CHARTS.keys()].join(" or mode=")}`, "invalid-config");
  return { mode };
}

/** The chart a validated configuration reads. */
export function picassoChart(config: SourceConfig): PicassoChart {
  const chart = PICASSO_CHARTS.get(validatePicassoFeedConfig(config).mode ?? "");
  if (!chart) throw new GatekeeperError("Picasso feed configuration lost its mode", "invalid-config");
  return chart;
}

/** The query the chart's own script makes. */
export function picassoUrl(config: SourceConfig, apiOrigin: string): URL {
  const mode = validatePicassoFeedConfig(config).mode ?? "";
  const chart = picassoChart(config);
  const url = new URL("/api/data/query", fixedOrigin(apiOrigin, PICASSO_ORIGIN));
  url.search = `?db=${chart.database}&q=gigapix&m=${mode}&p=`;
  return url;
}

/**
 * One chart's window, whole. Every answer differs from the last as the window slides, and the source states no
 * validators, so the checkpoint keeps none.
 */
export async function collectPicassoFeed(config: SourceConfig, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const url = picassoUrl(config, apiOrigin);
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "application/json" } });
  } catch (error) {
    throw new GatekeeperError(`Picasso request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new GatekeeperError(`Picasso returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  }
  const body = await readBoundedResponse(response, PICASSO_MAX_BYTES, "Picasso chart");
  return { kind: "body", body, provenance: { sourceUrl: GIGAPIX_STATISTICS_PAGE }, completeness: "complete", state: {} };
}
