import {
  GatekeeperError,
  allowedHosts,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  readBoundedResponse,
  retryAfterSeconds,
  type CollectionRequest,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
} from "#/index";

export const IODA_HOST = "api.ioda.inetintel.cc.gatech.edu";
/** A three-hour signal window of one entity is about 10 KB; a megabyte leaves room for a slower day. */
export const IODA_MAX_BYTES = 1024 * 1024;
/** The page size asked for; a full page means the window held more than one request can report. */
export const IODA_PAGE_LIMIT = 500;
export const IODA_MAX_WINDOW_DAYS = 30;
export const IODA_MAX_WINDOW_HOURS = 24;
/** IODA's shortest native step, and the grid every request window is aligned to. */
export const IODA_STEP_SECONDS = 300;

/**
 * The Portuguese networks this library may read, with the holder name IODA
 * itself returns from `/v2/entities/query` (the `name` attribute, checked
 * 2026-09-18). This service republishes Portuguese data, so an AS outside this
 * list is a configuration mistake rather than a new feed.
 */
export const IODA_PORTUGUESE_ASNS = new Map<string, string>([
  ["3243", "MEO-RESIDENCIAL"],
  ["2860", "NOS_COMUNICACOES"],
  ["12353", "VODAFONE-PT"],
  ["20879", "DIGI-PT"],
  ["15457", "NOS_MADEIRA"],
]);

export const IODA_FEEDS = {
  "outage-events": {
    kind: "outage-events",
    title: "Detected internet outage events",
    description:
      "Outage events IODA detected for one entity: when each one started, how long it lasted, which measurement source and detection method saw it, and how large the deviation was. Detections from academic measurement, not an operator's own incident report.",
    semantics: { domainSubject: "event", defaultProductRole: "event-log" },
  },
  "outage-alerts": {
    kind: "outage-alerts",
    title: "Internet outage alert levels",
    description:
      "The per-bin alert records behind IODA's outage events for one entity: the level a datasource crossed, the condition it crossed, the observed value and the historical value it was compared against.",
    semantics: { domainSubject: "event", defaultProductRole: "event-log" },
  },
  signals: {
    kind: "signals",
    title: "Internet connectivity signals",
    description:
      "IODA's raw connectivity measurements for one entity, one series per datasource: routed /24s seen in BGP, /24s answering active probes, unique source IPs at the Merit network telescope, and normalized Google traffic. Not a speed, quality or customer-availability report.",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
  },
} as const satisfies Record<string, FeedKindDescription>;

/** The path under `/v2/` each feed reads. */
export function endpoint(feed: string | undefined): string {
  if (feed === "outage-events") return "outages/events";
  if (feed === "outage-alerts") return "outages/alerts";
  if (feed === "signals") return "signals/raw";
  throw new GatekeeperError("Unsupported IODA feed", "invalid-config");
}

/** The `type` IODA stamps on the envelope of each endpoint, checked before anything is read. */
export function envelopeType(feed: string | undefined): string {
  if (feed === "outage-events") return "outages.events";
  if (feed === "outage-alerts") return "outages.alerts";
  return "signals";
}

export function validateIodaFeedConfig(config: SourceConfig): SourceConfig {
  const feed = config.feed?.trim();
  if (!feed || !Object.hasOwn(IODA_FEEDS, feed)) throw new GatekeeperError("IODA requires a supported named feed", "invalid-config");
  const allowed = feed === "signals" ? ["feed", "entityType", "entityCode", "hours"] : ["feed", "entityType", "entityCode", "days"];
  for (const key of Object.keys(config)) if (!allowed.includes(key)) throw new GatekeeperError(`Unsupported IODA field: ${key}`, "invalid-config");
  const entityType = config.entityType?.trim() ?? "country";
  if (entityType !== "country" && entityType !== "asn") throw new GatekeeperError("IODA feeds read a country or an asn entity", "invalid-config");
  const entityCode = entityCodeOf(entityType, config.entityCode);
  const normalized: SourceConfig = { feed, entityType, entityCode };
  if (feed === "signals") normalized.hours = window(config.hours, "hours", 3, IODA_MAX_WINDOW_HOURS);
  else normalized.days = window(config.days, "days", 7, IODA_MAX_WINDOW_DAYS);
  return normalized;
}

/** Portugal, or one of the Portuguese networks; this service republishes no other country's outages. */
function entityCodeOf(entityType: string, value: string | undefined): string {
  const code = value?.trim() ?? "";
  if (entityType === "country") {
    if (code.toUpperCase() !== "PT") throw new GatekeeperError("IODA country feeds require entityCode=PT", "invalid-config");
    return "PT";
  }
  const number = code.replace(/^AS/i, "");
  if (!IODA_PORTUGUESE_ASNS.has(number))
    throw new GatekeeperError(`IODA asn feeds require a Portuguese AS number: ${[...IODA_PORTUGUESE_ASNS.keys()].join(", ")}`, "invalid-config");
  return number;
}

function window(value: string | undefined, name: string, fallback: number, maximum: number): string {
  const text = value?.trim() ?? String(fallback);
  const amount = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(amount) || amount < 1 || amount > maximum) throw new GatekeeperError(`${name} must be 1..${maximum}`, "invalid-config");
  return String(amount);
}

/** How far back one collection asks, in seconds. */
export function windowSeconds(config: SourceConfig): number {
  return config.feed === "signals" ? Number(config.hours) * 3600 : Number(config.days) * 86_400;
}

/**
 * The request's upper bound, floored to IODA's shortest step. The bound only
 * frames the query: every row is dated by the source's own clock, never by it.
 */
export function windowEnd(now: Date): number {
  return Math.floor(now.getTime() / 1000 / IODA_STEP_SECONDS) * IODA_STEP_SECONDS;
}

export function iodaUrl(config: SourceConfig, host: string, now: Date): URL {
  const validated = validateIodaFeedConfig(config);
  const until = windowEnd(now);
  const from = until - windowSeconds(validated);
  const path = endpoint(validated.feed);
  // Both were rewritten by the validator above: a country is PT, an AS is one of the Portuguese networks.
  const entityType = validated.entityType ?? "country";
  const entityCode = validated.entityCode ?? "PT";
  const url = new URL(validated.feed === "signals" ? `/v2/${path}/${entityType}/${entityCode}` : `/v2/${path}`, `https://${host}`);
  url.searchParams.set("from", String(from));
  url.searchParams.set("until", String(until));
  if (validated.feed !== "signals") {
    url.searchParams.set("entityType", entityType);
    url.searchParams.set("entityCode", entityCode);
    url.searchParams.set("limit", String(IODA_PAGE_LIMIT));
    // IODA otherwise widens the search by a fortnight on both sides, which would
    // report the same event under a dozen different windows.
    url.searchParams.set("extendWindow", "0");
  }
  return url;
}

export async function collectIodaFeed(
  config: SourceConfig,
  hosts: ReadonlySet<string>,
  fetcher: typeof fetch,
  mode: CollectionRequest["mode"] = { kind: "live" },
  now = new Date(),
): Promise<SourceFetch> {
  if (mode.kind === "history") throw new GatekeeperError("IODA has no historical walker in this library", "invalid-config");
  const validated = validateIodaFeedConfig(config);
  if (!hosts.has(IODA_HOST)) throw new GatekeeperError("The IODA host is not allowed by this deployment", "source-denied");
  const url = iodaUrl(validated, IODA_HOST, now);
  const response = await request(fetcher, url);
  if (!response.ok || !response.body) throw new GatekeeperError(`IODA returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  if (Number(response.headers.get("content-length")) > IODA_MAX_BYTES) {
    await response.body.cancel("IODA source exceeded its byte bound");
    throw new GatekeeperError("IODA source exceeded its byte bound", "response-too-large");
  }
  const bytes = await readBoundedResponse(response, IODA_MAX_BYTES, "IODA response");
  // Every request names its own moving window, so an ETag from the last one could
  // never match this one: the checkpoint carries no validators at all.
  return { kind: "body", body: bytes, provenance: { sourceUrl: url.toString() }, completeness: "complete", state: {} };
}

/**
 * IODA answers 200 with an `error` member on failures and stamps every body
 * with its endpoint's `type` and its copyright line; all three are checked
 * before a single row is read.
 */
export function envelope(value: JsonValue | undefined, expectedType: string): JsonObject {
  if (!isJsonObject(value) || value.type !== expectedType || !Array.isArray(value.data))
    throw new GatekeeperError("IODA returned an invalid or unexpected API envelope", "invalid-response");
  if (value.error !== null && value.error !== undefined) throw new GatekeeperError("IODA reported an API error", "invalid-response");
  if (!isJsonString(value.copyright) || !value.copyright.includes("Georgia Tech")) throw new GatekeeperError("IODA omitted its copyright statement", "invalid-response");
  return value;
}

/** A unix-second source clock as ISO 8601, rejecting anything outside IODA's lifetime. */
export function sourceTime(value: JsonValue | undefined): string {
  if (!isJsonNumber(value) || !Number.isSafeInteger(value) || value < 1_000_000_000 || value > 4_000_000_000)
    throw new GatekeeperError("IODA returned an invalid unix timestamp", "invalid-response");
  return new Date(value * 1000).toISOString();
}

export function object(value: JsonValue | undefined): JsonObject {
  if (!isJsonObject(value)) throw new GatekeeperError("IODA omitted a required object", "invalid-response");
  return value;
}

export function text(value: JsonValue | undefined, name: string): string {
  if (!isJsonString(value) || value.trim() === "" || value.length > 200) throw new GatekeeperError(`IODA returned an invalid ${name}`, "invalid-response");
  return value.trim();
}

export function number(value: JsonValue | undefined, name: string): number {
  if (!isJsonNumber(value) || !Number.isFinite(value)) throw new GatekeeperError(`IODA returned an invalid ${name}`, "invalid-response");
  return value;
}

export function iodaHosts(value: string): ReadonlySet<string> {
  const hosts = allowedHosts(value);
  if (hosts.size === 0) throw new GatekeeperError("IODA_ALLOWED_HOSTS is empty", "source-denied");
  return hosts;
}

async function request(fetcher: typeof fetch, url: URL): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(60_000) });
  } catch (error) {
    throw new GatekeeperError(`IODA request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if ((response.status >= 300 && response.status < 400) || (response.url && new URL(response.url).origin !== url.origin))
    throw new GatekeeperError("IODA redirects are not allowed", "source-denied");
  return response;
}
