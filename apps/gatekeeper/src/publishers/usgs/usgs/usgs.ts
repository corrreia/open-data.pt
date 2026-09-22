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

export const USGS_API_ORIGIN = "https://earthquake.usgs.gov";
export const USGS_MAX_BYTES = 4 * 1024 * 1024;
export const USGS_REGIONS = {
  mainland: { name: "mainland Portugal", bounds: [36.8, 42.2, -9.6, -6.1] },
  madeira: { name: "Madeira", bounds: [30.0, 34.5, -19.5, -14.0] },
  azores: { name: "the Azores", bounds: [35.0, 41.5, -33.5, -23.0] },
} as const;

export const USGS_FEEDS = {
  earthquakes: {
    kind: "earthquakes",
    title: "Earthquake events",
    description: "Earthquakes in a Portugal bounding region from the USGS FDSN Event Web Service.",
    semantics: { domainSubject: "event", defaultProductRole: "event-log" },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function validateUsgsFeedConfig(config: SourceConfig): SourceConfig {
  if (config.feed !== "earthquakes") throw new GatekeeperError("USGS requires feed=earthquakes", "invalid-config");
  for (const key of Object.keys(config))
    if (!["feed", "region", "days", "minMagnitude"].includes(key))
      throw new GatekeeperError(`Unsupported USGS field: ${key}`, key === "host" || key === "url" ? "source-denied" : "invalid-config");
  const region = config.region?.trim();
  if (region !== "mainland" && region !== "madeira" && region !== "azores") throw new GatekeeperError("USGS requires region=mainland, madeira or azores", "invalid-config");
  const days = integer(config.days, "days", 1, 366);
  const magnitude = Number(config.minMagnitude);
  if (!Number.isFinite(magnitude) || magnitude < 0 || magnitude > 10) throw new GatekeeperError("minMagnitude must be between 0 and 10", "invalid-config");
  return { feed: "earthquakes", region, days: String(days), minMagnitude: String(magnitude) };
}

export function usgsUrl(config: SourceConfig, origin: string, now: Date): URL {
  const validated = validateUsgsFeedConfig(config);
  if (origin !== USGS_API_ORIGIN) throw new GatekeeperError("The USGS API origin is not allowed", "source-denied");
  const region = regionOf(validated.region);
  const end = new Date(Math.floor(now.getTime() / 60_000) * 60_000);
  const start = new Date(end.getTime() - Number(validated.days) * 86_400_000);
  const url = new URL("/fdsnws/event/1/query", origin);
  url.searchParams.set("format", "geojson");
  url.searchParams.set("starttime", start.toISOString());
  url.searchParams.set("endtime", end.toISOString());
  url.searchParams.set("minlatitude", String(region.bounds[0]));
  url.searchParams.set("maxlatitude", String(region.bounds[1]));
  url.searchParams.set("minlongitude", String(region.bounds[2]));
  url.searchParams.set("maxlongitude", String(region.bounds[3]));
  url.searchParams.set("minmagnitude", validated.minMagnitude ?? "1");
  url.searchParams.set("orderby", "time-asc");
  url.searchParams.set("limit", "20000");
  return url;
}

export async function collectUsgsFeed(config: SourceConfig, checkpoint: SourceValidator | undefined, origin: string, fetcher: typeof fetch, now: Date): Promise<SourceFetch> {
  const url = usgsUrl(config, origin, now);
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "application/geo+json, application/json" }, redirect: "manual" });
  } catch (error) {
    throw new GatekeeperError(`USGS request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if ((response.status >= 300 && response.status < 400) || (response.url && new URL(response.url).origin !== url.origin))
    throw new GatekeeperError("USGS redirects are not allowed", "source-denied");
  if (!response.ok) throw new GatekeeperError(`USGS returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  const bytes = await readBoundedResponse(response, USGS_MAX_BYTES, "USGS earthquake response");
  let value;
  try {
    value = parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError("USGS returned invalid JSON", "invalid-response");
  }
  if (!isJsonObject(value) || value.type !== "FeatureCollection" || !Array.isArray(value.features))
    throw new GatekeeperError("USGS returned malformed GeoJSON", "invalid-response");
  const body = new TextEncoder().encode(JSON.stringify({ type: "FeatureCollection", features: value.features }));
  const etag = await contentEtag(body);
  if (checkpoint?.etag === etag) return { kind: "not-modified", validator: { etag } };
  return { kind: "body", body, provenance: { sourceUrl: url.toString() }, completeness: "complete", validator: { etag } };
}

function regionOf(value: string | undefined): (typeof USGS_REGIONS)[keyof typeof USGS_REGIONS] {
  if (value === "mainland" || value === "madeira" || value === "azores") return USGS_REGIONS[value];
  throw new GatekeeperError("USGS region was not resolved", "invalid-config");
}

function integer(value: string | undefined, name: string, minimum: number, maximum: number): number {
  if (!value || !/^\d+$/u.test(value)) throw new GatekeeperError(`${name} must be an integer`, "invalid-config");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new GatekeeperError(`${name} must be ${minimum}..${maximum}`, "invalid-config");
  return parsed;
}
