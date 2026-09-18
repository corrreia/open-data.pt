import { GatekeeperError, retryAfterSeconds, type FeedKindDescription, type SourceConfig, type SourceFetch } from "../../index";

export const FIRMS_API_ORIGIN = "https://firms.modaps.eosdis.nasa.gov";
export const FIRMS_MAX_BYTES = 4 * 1024 * 1024;
export const FIRMS_DAY_RANGE = 5;

export const FIRMS_REGIONS = {
  mainland: { name: "mainland Portugal", bbox: "-9.6,36.8,-6.1,42.2" },
  madeira: { name: "Madeira", bbox: "-17.4,32.3,-15.7,33.3" },
  azores: { name: "the Azores", bbox: "-31.5,36.8,-24.8,40.1" },
} as const;

export const FIRMS_PRODUCTS = ["VIIRS_SNPP_NRT", "VIIRS_NOAA20_NRT", "VIIRS_NOAA21_NRT", "MODIS_NRT"] as const;

export const FIRMS_FEEDS = {
  hotspots: {
    kind: "hotspots",
    title: "Satellite thermal anomalies",
    description: "NASA FIRMS active-fire and thermal-anomaly pixels from one MODIS or VIIRS near-real-time product.",
    semantics: { domainSubject: "event", defaultProductRole: "event-log" },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function validateFirmsFeedConfig(config: SourceConfig): SourceConfig {
  if (config.feed !== "hotspots") throw new GatekeeperError("FIRMS requires feed=hotspots", "invalid-config");
  for (const key of Object.keys(config))
    if (!["feed", "region", "product"].includes(key))
      throw new GatekeeperError(`Unsupported FIRMS field: ${key}`, key === "host" || key === "url" ? "source-denied" : "invalid-config");
  const region = config.region?.trim();
  const product = config.product?.trim();
  if (!region || !Object.hasOwn(FIRMS_REGIONS, region)) throw new GatekeeperError("FIRMS requires region=mainland, madeira or azores", "invalid-config");
  if (!product || !FIRMS_PRODUCTS.some((candidate) => candidate === product)) throw new GatekeeperError("FIRMS requires a supported MODIS or VIIRS NRT product", "invalid-config");
  return { feed: "hotspots", region, product };
}

export function firmsUrl(config: SourceConfig, origin: string, mapKey: string): URL {
  const validated = validateFirmsFeedConfig(config);
  if (origin !== FIRMS_API_ORIGIN) throw new GatekeeperError("The FIRMS API origin is not allowed", "source-denied");
  if (!/^[A-Za-z0-9_-]{8,128}$/u.test(mapKey)) throw new GatekeeperError("NASA_FIRMS_MAP_KEY is not configured", "source-denied");
  const region = regionOf(validated.region);
  return new URL(`/api/area/csv/${encodeURIComponent(mapKey)}/${validated.product}/${region.bbox}/${FIRMS_DAY_RANGE}`, origin);
}

function regionOf(value: string | undefined): (typeof FIRMS_REGIONS)[keyof typeof FIRMS_REGIONS] {
  if (value === "mainland" || value === "madeira" || value === "azores") return FIRMS_REGIONS[value];
  throw new GatekeeperError("FIRMS region was not resolved", "invalid-config");
}

export async function collectFirmsFeed(config: SourceConfig, origin: string, mapKey: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const url = firmsUrl(config, origin, mapKey);
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "text/csv" }, redirect: "manual" });
  } catch (error) {
    throw new GatekeeperError(`FIRMS request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if ((response.status >= 300 && response.status < 400) || (response.url && new URL(response.url).origin !== url.origin))
    throw new GatekeeperError("FIRMS redirects are not allowed", "source-denied");
  if (!response.ok || !response.body) throw new GatekeeperError(`FIRMS returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > FIRMS_MAX_BYTES) {
    await response.body.cancel("FIRMS response exceeded its byte bound");
    throw new GatekeeperError("FIRMS response exceeded its byte bound", "response-too-large");
  }
  return {
    kind: "body",
    body: response.body,
    provenance: { sourceUrl: `${FIRMS_API_ORIGIN}/api/area/` },
    completeness: "complete",
    state: {},
  };
}
