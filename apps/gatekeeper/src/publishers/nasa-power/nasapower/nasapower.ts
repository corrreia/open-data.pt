import {
  GatekeeperError,
  contentEtag,
  isJsonObject,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  type FeedKindDescription,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "#/index";

export const NASA_POWER_API_ORIGIN = "https://power.larc.nasa.gov";
export const NASA_POWER_MAX_BYTES = 4 * 1024 * 1024;
/** All-sky solar radiation currently settles about three months after observation. */
export const NASA_POWER_LAG_DAYS = 90;
export const NASA_POWER_REGIONS = {
  mainland: { name: "mainland Portugal", bounds: [36.8, 42.2, -9.6, -6.1] },
  // POWER's regional endpoint requires a range wider than two degrees on both axes.
  madeira: { name: "Madeira", bounds: [31.5, 34, -18.5, -15.5] },
  azores: { name: "the Azores", bounds: [36.8, 40.1, -31.5, -24.8] },
} as const;
export const NASA_POWER_PARAMETERS = ["ALLSKY_SFC_SW_DWN", "T2M", "PRECTOTCORR", "WS10M"] as const;

export const NASA_POWER_FEEDS = {
  "daily-region": {
    kind: "daily-region",
    title: "Daily gridded solar and meteorological analysis",
    description: "NASA POWER daily analysis-ready values on the source grid for one Portugal bounding region and parameter.",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function validateNasaPowerFeedConfig(config: SourceConfig): SourceConfig {
  if (config.feed !== "daily-region") throw new GatekeeperError("NASA POWER requires feed=daily-region", "invalid-config");
  for (const key of Object.keys(config))
    if (!["feed", "region", "parameter", "days"].includes(key))
      throw new GatekeeperError(`Unsupported NASA POWER field: ${key}`, key === "host" || key === "url" ? "source-denied" : "invalid-config");
  const region = config.region?.trim();
  if (region !== "mainland" && region !== "madeira" && region !== "azores") throw new GatekeeperError("NASA POWER requires region=mainland, madeira or azores", "invalid-config");
  const parameter = config.parameter?.trim();
  if (!parameter || !NASA_POWER_PARAMETERS.some((candidate) => candidate === parameter)) throw new GatekeeperError("NASA POWER requires a supported parameter", "invalid-config");
  const days = integer(config.days, "days", 1, 90);
  return { feed: "daily-region", region, parameter, days: String(days) };
}

export function nasaPowerUrl(config: SourceConfig, origin: string, now: Date): URL {
  const validated = validateNasaPowerFeedConfig(config);
  if (origin !== NASA_POWER_API_ORIGIN) throw new GatekeeperError("The NASA POWER API origin is not allowed", "source-denied");
  const region = regionOf(validated.region);
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - NASA_POWER_LAG_DAYS));
  const start = new Date(end.getTime() - (Number(validated.days) - 1) * 86_400_000);
  const compact = (date: Date): string => date.toISOString().slice(0, 10).replaceAll("-", "");
  const url = new URL("/api/temporal/daily/regional", origin);
  url.searchParams.set("latitude-min", String(region.bounds[0]));
  url.searchParams.set("latitude-max", String(region.bounds[1]));
  url.searchParams.set("longitude-min", String(region.bounds[2]));
  url.searchParams.set("longitude-max", String(region.bounds[3]));
  url.searchParams.set("parameters", validated.parameter ?? "ALLSKY_SFC_SW_DWN");
  url.searchParams.set("community", "RE");
  url.searchParams.set("start", compact(start));
  url.searchParams.set("end", compact(end));
  url.searchParams.set("format", "JSON");
  url.searchParams.set("time-standard", "UTC");
  return url;
}

export async function collectNasaPowerFeed(config: SourceConfig, checkpoint: SourceValidator | undefined, origin: string, fetcher: typeof fetch, now: Date): Promise<SourceFetch> {
  const url = nasaPowerUrl(config, origin, now);
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "application/json" }, redirect: "manual" });
  } catch (error) {
    throw new GatekeeperError(`NASA POWER request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if ((response.status >= 300 && response.status < 400) || (response.url && new URL(response.url).origin !== url.origin))
    throw new GatekeeperError("NASA POWER redirects are not allowed", "source-denied");
  if (!response.ok) throw new GatekeeperError(`NASA POWER returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  const bytes = await readBoundedResponse(response, NASA_POWER_MAX_BYTES, "NASA POWER response");
  let value;
  try {
    value = parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError("NASA POWER returned invalid JSON", "invalid-response");
  }
  if (!isJsonObject(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features))
    throw new GatekeeperError("NASA POWER returned malformed JSON", "invalid-response");
  const body = new TextEncoder().encode(JSON.stringify({ type: "FeatureCollection", features: value.features, parameters: value.parameters }));
  const etag = await contentEtag(body);
  if (checkpoint?.etag === etag) return { kind: "not-modified", validator: { etag } };
  return { kind: "body", body, provenance: { sourceUrl: url.toString() }, completeness: "complete", validator: { etag } };
}

function regionOf(value: string | undefined): (typeof NASA_POWER_REGIONS)[keyof typeof NASA_POWER_REGIONS] {
  if (value === "mainland" || value === "madeira" || value === "azores") return NASA_POWER_REGIONS[value];
  throw new GatekeeperError("NASA POWER region was not resolved", "invalid-config");
}

function integer(value: string | undefined, name: string, minimum: number, maximum: number): number {
  if (!value || !/^\d+$/u.test(value)) throw new GatekeeperError(`${name} must be an integer`, "invalid-config");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new GatekeeperError(`${name} must be ${minimum}..${maximum}`, "invalid-config");
  return parsed;
}
