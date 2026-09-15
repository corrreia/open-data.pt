import {
  GatekeeperError,
  fixedOrigin,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  responseValidator,
  type FeedKindDescription,
  type JsonValue,
  type SourceBody,
  type SourceFetch,
  type SourceValidator,
  type SourceConfig,
} from "../../index";

const ALLOWED_ORIGIN = "https://api.ipma.pt";

export const IPMA_FEEDS = {
  "station-observations": {
    kind: "station-observations",
    title: "Meteorological station observations",
    description: "Hourly observations from the last 24 hours, with station names and coordinates.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "time-series",
    },
  },
  "daily-forecast": {
    kind: "daily-forecast",
    title: "Daily city forecasts",
    description: "Daily meteorological forecasts for Portuguese district capitals and islands for the next three days.",
    semantics: {
      domainSubject: "reference",
      defaultProductRole: "reference",
    },
  },
  seismic: {
    kind: "seismic",
    title: "Seismic events",
    description: "The last 30 days of seismic events for mainland Portugal, Madeira, and the Azores.",
    semantics: {
      domainSubject: "event",
      defaultProductRole: "event-log",
    },
  },
  warnings: {
    kind: "warnings",
    title: "Weather warnings",
    description: "Weather warnings by district or island, with severity and validity periods.",
    semantics: {
      domainSubject: "event",
      defaultProductRole: "event-log",
    },
  },
  "uv-index": {
    kind: "uv-index",
    title: "UV index forecast",
    description: "Daily ultraviolet index forecasts for IPMA forecast locations.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "reference",
    },
  },
  "fire-risk": {
    kind: "fire-risk",
    title: "Municipal fire risk forecast",
    description: "Three-day rural fire danger forecasts by municipality code.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "current-state",
    },
  },
  "sea-forecast": {
    kind: "sea-forecast",
    title: "Sea forecast",
    description: "Three-day wave and sea-surface forecasts for Portuguese coastal locations.",
    semantics: {
      domainSubject: "observation",
      defaultProductRole: "reference",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

export type IpmaFeedName = keyof typeof IPMA_FEEDS;

/** The largest document each IPMA feed may return, in bytes. */
type FeedLimits = { [Feed in IpmaFeedName]: number };

export const IPMA_FEED_LIMITS: FeedLimits = {
  "station-observations": 3 * 1024 * 1024,
  "daily-forecast": 2 * 1024 * 1024,
  seismic: 2 * 1024 * 1024,
  warnings: 128 * 1024,
  "uv-index": 128 * 1024,
  "fire-risk": 128 * 1024,
  "sea-forecast": 64 * 1024,
};

/** The IPMA paths each feed collects, in the order it reads them. */
type FeedEndpoints = { [Feed in IpmaFeedName]: readonly string[] };

const ENDPOINTS: FeedEndpoints = {
  "station-observations": [
    "/open-data/observation/meteorology/stations/observations.json",
    "/open-data/observation/meteorology/stations/stations.json",
  ],
  "daily-forecast": [
    "/open-data/forecast/meteorology/cities/daily/hp-daily-forecast-day0.json",
    "/open-data/forecast/meteorology/cities/daily/hp-daily-forecast-day1.json",
    "/open-data/forecast/meteorology/cities/daily/hp-daily-forecast-day2.json",
    "/open-data/distrits-islands.json",
    "/open-data/weather-type-classe.json",
    "/open-data/wind-speed-daily-classe.json",
  ],
  seismic: [
    "/open-data/observation/seismic/7.json",
    "/open-data/observation/seismic/3.json",
  ],
  warnings: [
    "/open-data/forecast/warnings/warnings_www.json",
    "/open-data/distrits-islands.json",
  ],
  "uv-index": [
    "/open-data/forecast/meteorology/uv/uv.json",
    "/open-data/distrits-islands.json",
  ],
  "fire-risk": [
    "/open-data/forecast/meteorology/rcm/rcm-d0.json",
    "/open-data/forecast/meteorology/rcm/rcm-d1.json",
    "/open-data/forecast/meteorology/rcm/rcm-d2.json",
    "/open-data/distrits-islands.json",
  ],
  "sea-forecast": [
    "/open-data/forecast/oceanography/daily/hp-daily-sea-forecast-day0.json",
    "/open-data/forecast/oceanography/daily/hp-daily-sea-forecast-day1.json",
    "/open-data/forecast/oceanography/daily/hp-daily-sea-forecast-day2.json",
    "/open-data/sea-locations.json",
  ],
};

interface CollectedResource {
  bytes: Uint8Array;
  parsed: JsonValue;
  response: Response;
  url: URL;
}

export function validateIpmaFeedConfig(config: SourceConfig): SourceConfig {
  const feed = config.feed;
  if (!isFeedName(feed)) {
    throw new GatekeeperError("IPMA feeds require feed=station-observations, daily-forecast, seismic, warnings, uv-index, fire-risk, or sea-forecast", "invalid-config");
  }
  const unsupported = Object.keys(config).filter((key) => key !== "feed");
  if (unsupported.length > 0) {
    throw new GatekeeperError(`IPMA feed configuration does not accept ${unsupported.join(", ")}`, "source-denied");
  }
  return { feed };
}

export async function collectIpmaFeed(
  config: SourceConfig,
  checkpoint: SourceValidator | undefined,
  apiOrigin: string,
  fetcher: typeof fetch,
): Promise<SourceFetch> {
  const validated = validateIpmaFeedConfig(config);
  // SAFETY: `validateIpmaFeedConfig` has just confirmed `feed` names one of
  // the feeds IPMA_FEEDS declares.
  const feed = validated.feed as IpmaFeedName;
  const origin = fixedOrigin(apiOrigin, ALLOWED_ORIGIN);
  const paths = ENDPOINTS[feed];
  const requestHeaders = new Headers({ Accept: "application/json" });
  // A validator from one component cannot prove a compound feed unchanged.
  // Multi-resource feeds fetch every component and rely on semantic no-op
  // suppression after normalization.
  if (paths.length === 1 && checkpoint?.etag) requestHeaders.set("If-None-Match", checkpoint.etag);
  if (paths.length === 1 && checkpoint?.lastModified) {
    requestHeaders.set("If-Modified-Since", checkpoint.lastModified);
  }

  const primaryUrl = new URL(paths[0]!, origin);
  const primaryResponse = await fetcher(primaryUrl, { headers: requestHeaders });
  const validator = responseValidator(primaryResponse.headers);
  if (primaryResponse.status === 304) {
    return validator ? { kind: "not-modified", validator } : { kind: "not-modified" };
  }
  const maximumBytes = IPMA_FEED_LIMITS[feed];
  const primary = await readJsonResource(primaryResponse, primaryUrl, maximumBytes);
  const resources: CollectedResource[] = [primary];
  let remainingBytes = maximumBytes - primary.bytes.byteLength;

  for (const path of paths.slice(1)) {
    const url = new URL(path, origin);
    const response = await fetcher(url, {
      headers: { Accept: "application/json" },
    });
    const resource = await readJsonResource(response, url, remainingBytes);
    resources.push(resource);
    remainingBytes -= resource.bytes.byteLength;
  }

  const bytes = combinedDocument(feed, resources.map((resource) => resource.bytes));
  if (bytes.byteLength > maximumBytes) {
    throw new GatekeeperError(`IPMA ${feed} response exceeded ${maximumBytes} bytes`, "response-too-large");
  }

  const fetched: SourceBody = {
    kind: "body",
    body: bytes,
    provenance: { sourceUrl: primaryUrl.toString() },
    // Every IPMA resource a feed names is fetched whole, so the document is the feed's whole scope.
    completeness: "complete",
  };
  const sourcePublishedAt = publishedAt(feed, resources);
  if (sourcePublishedAt) fetched.provenance.sourcePublishedAt = sourcePublishedAt;
  if (validator) fetched.validator = validator;
  return fetched;
}

function isFeedName(value: string | undefined): value is IpmaFeedName {
  return value !== undefined && Object.hasOwn(IPMA_FEEDS, value);
}

async function readJsonResource(
  response: Response,
  url: URL,
  maximumBytes: number,
): Promise<CollectedResource> {
  if (!response.ok || !response.body) {
    throw new GatekeeperError(`IPMA returned HTTP ${response.status} for ${url.pathname}`, "upstream-error");
  }
  const declared = response.headers.get("content-length");
  if (declared && Number(declared) > maximumBytes) {
    throw new GatekeeperError(`IPMA response for ${url.pathname} exceeded ${maximumBytes} bytes`, "response-too-large");
  }

  const chunks: Uint8Array[] = [];
  const reader = response.body.getReader();
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel("IPMA response exceeded maximum size");
      throw new GatekeeperError(`IPMA response for ${url.pathname} exceeded ${maximumBytes} bytes`, "response-too-large");
    }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  let parsed: JsonValue;
  try {
    parsed = parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError(`IPMA returned invalid JSON for ${url.pathname}`, "invalid-response");
  }
  return { bytes, parsed, response, url };
}

function combinedDocument(feed: IpmaFeedName, resources: Uint8Array[]): Uint8Array {
  switch (feed) {
    case "station-observations":
      return joinJson([
        '{"stations":', resources[1]!, ',"observations":', resources[0]!, "}",
      ]);
    case "daily-forecast":
      return joinJson([
        '{"forecasts":[', resources[0]!, ",", resources[1]!, ",", resources[2]!,
        '],"cities":', resources[3]!, ',"weatherTypes":', resources[4]!,
        ',"windSpeedClasses":', resources[5]!, "}",
      ]);
    case "seismic":
      return joinJson([
        '{"mainlandMadeira":', resources[0]!, ',"azores":', resources[1]!, "}",
      ]);
    case "warnings":
      return joinJson([
        '{"warnings":', resources[0]!, ',"areas":', resources[1]!, "}",
      ]);
    case "uv-index":
      return joinJson([
        '{"uv":', resources[0]!, ',"cities":', resources[1]!, "}",
      ]);
    case "fire-risk":
      return joinJson([
        '{"forecasts":[', resources[0]!, ",", resources[1]!, ",", resources[2]!,
        '],"municipalities":', resources[3]!, "}",
      ]);
    case "sea-forecast":
      return joinJson([
        '{"forecasts":[', resources[0]!, ",", resources[1]!, ",", resources[2]!,
        '],"locations":', resources[3]!, "}",
      ]);
  }
}

function joinJson(parts: Array<string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder();
  const encoded = parts.map((part) => (part instanceof Uint8Array ? part : encoder.encode(part)));
  const total = encoded.reduce((size, part) => size + part.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const part of encoded) {
    result.set(part, offset);
    offset += part.byteLength;
  }
  return result;
}

function publishedAt(feed: IpmaFeedName, resources: CollectedResource[]): string | undefined {
  const stated: string[] = [];
  if (feed === "daily-forecast") {
    for (const resource of resources.slice(0, 3)) {
      if (isJsonObject(resource.parsed) && isJsonString(resource.parsed.dataUpdate)) {
        stated.push(resource.parsed.dataUpdate);
      }
    }
  } else if (feed === "seismic") {
    for (const resource of resources) {
      if (isJsonObject(resource.parsed) && isJsonString(resource.parsed.updateDate)) {
        stated.push(resource.parsed.updateDate);
      }
    }
  } else if (feed === "fire-risk") {
    for (const resource of resources.slice(0, 3)) {
      if (isJsonObject(resource.parsed) && isJsonString(resource.parsed.fileDate)) {
        stated.push(resource.parsed.fileDate);
      }
    }
  } else if (feed === "sea-forecast") {
    for (const resource of resources.slice(0, 3)) {
      if (isJsonObject(resource.parsed) && isJsonString(resource.parsed.dataUpdate)) {
        stated.push(resource.parsed.dataUpdate);
      }
    }
  }
  return stated.map(normalizeDateTime).filter((value): value is string => Boolean(value)).sort().at(-1)
    ?? normalizeDateTime(resources[0]?.response.headers.get("last-modified") ?? null);
}

function normalizeDateTime(value: string | null): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  const explicit = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/u.test(trimmed)
    ? `${trimmed.replace(" ", "T")}Z`
    : trimmed;
  const milliseconds = Date.parse(explicit);
  return Number.isNaN(milliseconds) ? undefined : new Date(milliseconds).toISOString();
}
