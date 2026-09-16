import {
  GatekeeperError,
  fixedOrigin,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedResponse,
  responseValidator,
  retryAfterSeconds,
  sourceValidator,
  type CollectionRequest,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
} from "../../index";

export const RIPESTAT_ORIGIN = "https://stat.ripe.net";
export const RIPESTAT_MAX_BYTES = 1024 * 1024;
export const RIPESTAT_MAX_DAYS = 90;
const DAY_MS = 86_400_000;

export const RIPESTAT_FEEDS = {
  "country-resources": {
    kind: "country-resources",
    title: "Registered country internet resources",
    description: "RIR-statistics AS numbers and IPv4/IPv6 resources registered to Portugal, not physical network geolocation or allocation dates.",
    semantics: { domainSubject: "reference", defaultProductRole: "reference" },
  },
  "country-routing": {
    kind: "country-routing",
    title: "Country internet routing observations",
    description: "Bounded daily Portuguese RIS prefix/ASN observations and RIR registered-ASN counts, using source dates and availability boundaries.",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
    history: { earliest: "2004-01-01T00:00:00.000Z" },
  },
  "routing-status": {
    kind: "routing-status",
    title: "Autonomous-system routing snapshot",
    description: "RIPE RIS eight-hour routing snapshots for one AS, not first-party customer outages, availability or broadband speeds.",
    semantics: { domainSubject: "observation", defaultProductRole: "current-state" },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function validateRipestatFeedConfig(config: SourceConfig): SourceConfig {
  const feed = config.feed?.trim();
  if (!feed || !Object.hasOwn(RIPESTAT_FEEDS, feed)) throw new GatekeeperError("RIPEstat requires a supported named feed", "invalid-config");
  const allowed = feed === "routing-status" ? ["feed", "asn"] : feed === "country-routing" ? ["feed", "country", "days"] : ["feed", "country"];
  for (const key of Object.keys(config)) if (!allowed.includes(key)) throw new GatekeeperError(`Unsupported RIPEstat field: ${key}`, "invalid-config");
  if (feed === "routing-status") return { feed, asn: asn(config.asn) };
  if (config.country?.trim().toUpperCase() !== "PT") throw new GatekeeperError("RIPEstat country feeds require country=PT", "invalid-config");
  const normalized: SourceConfig = { feed, country: "PT" };
  if (feed === "country-routing") {
    const value = config.days?.trim() ?? "30";
    const days = Number(value);
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(days) || days < 1 || days > RIPESTAT_MAX_DAYS)
      throw new GatekeeperError(`days must be 1..${RIPESTAT_MAX_DAYS}`, "invalid-config");
    normalized.days = String(days);
  }
  return normalized;
}

/** A canonical AS number, without an AS prefix. */
export function asn(value: JsonValue | undefined): string {
  const text = isJsonString(value) ? value.trim().replace(/^AS/i, "") : isJsonNumber(value) ? String(value) : "";
  const number = Number(text);
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(number) || number < 1 || number > 4_294_967_295)
    throw new GatekeeperError("ASN must be an integer from 1 to 4294967295", "invalid-config");
  return String(number);
}

export function endpoint(feed: string | undefined): string {
  if (feed === "country-resources") return "country-resource-list";
  if (feed === "country-routing") return "country-routing-stats";
  if (feed === "routing-status") return "routing-status";
  throw new GatekeeperError("Unsupported RIPEstat feed", "invalid-config");
}

/** UTC source clocks; never use the top-level `time`/query ID as an observation. */
export function sourceTime(value: JsonValue | undefined): string {
  if (!isJsonString(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})?$/.test(value))
    throw new GatekeeperError("RIPEstat source timestamp is invalid", "invalid-response");
  const calendar = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(calendar.getTime()) || calendar.toISOString().slice(0, 10) !== value.slice(0, 10))
    throw new GatekeeperError("RIPEstat source calendar date is invalid", "invalid-response");
  const stamp = /(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? value : `${value}Z`;
  const date = new Date(stamp);
  if (!Number.isFinite(date.getTime())) throw new GatekeeperError("RIPEstat source timestamp is invalid", "invalid-response");
  return date.toISOString();
}

/** Validate API-level failures even when HTTP transport returned 200. */
export function envelope(value: JsonValue | undefined, expectedEndpoint: string): JsonObject {
  if (
    !isJsonObject(value) ||
    value.status !== "ok" ||
    value.status_code !== 200 ||
    value.data_call_name !== expectedEndpoint ||
    !isJsonString(value.data_call_status) ||
    !value.data_call_status.startsWith("supported") ||
    !isJsonObject(value.data)
  ) {
    throw new GatekeeperError("RIPEstat returned an invalid or unsuccessful API envelope", "invalid-response");
  }
  if (Array.isArray(value.messages) && value.messages.some((message) => Array.isArray(message) && message[0] === "error"))
    throw new GatekeeperError("RIPEstat reported an API error", "invalid-response");
  return value.data;
}

export function hasWarnings(value: JsonObject): boolean {
  return Array.isArray(value.messages) && value.messages.some((message) => Array.isArray(message) && message[0] === "warning");
}

export async function collectRipestatFeed(
  config: SourceConfig,
  state: JsonObject | undefined,
  apiOrigin: string,
  fetcher: typeof fetch,
  mode: CollectionRequest["mode"] = { kind: "live" },
  now = new Date(),
): Promise<SourceFetch> {
  const validated = validateRipestatFeedConfig(config);
  if (mode.kind === "history" && (mode.cursor.offset !== undefined || mode.cursor.token !== undefined))
    throw new GatekeeperError("RIPEstat history only accepts a before cursor", "invalid-config");
  const origin = fixedOrigin(apiOrigin, RIPESTAT_ORIGIN);
  const name = endpoint(validated.feed);
  const url = new URL(`/data/${name}/data.json`, origin);
  url.searchParams.set("resource", validated.asn ? `AS${validated.asn}` : "PT");
  let from: string | undefined;
  let before: string | undefined;
  if (validated.feed === "country-routing") {
    const end = mode.kind === "history" ? historyBefore(mode.cursor.before) : new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())).toISOString();
    before = end;
    from = new Date(Date.parse(end) - Number(validated.days) * DAY_MS).toISOString();
    // RIPEstat's parser accepts this UTC form, but rejects fractional-second ISO strings with Z.
    url.searchParams.set("starttime", from.slice(0, 19));
    url.searchParams.set("endtime", before.slice(0, 19));
    url.searchParams.set("resolution", "1d");
  } else if (mode.kind === "history") throw new GatekeeperError("This RIPEstat capability has no historical walker", "invalid-config");
  if (validated.feed === "routing-status") url.searchParams.set("min_peers_seeing", "10");
  const previous = mode.kind === "live" && state?.url === url.toString() ? sourceValidator(state) : undefined;
  const headers = new Headers({ Accept: "application/json" });
  if (previous?.etag) headers.set("If-None-Match", previous.etag);
  if (previous?.lastModified) headers.set("If-Modified-Since", previous.lastModified);
  const response = await request(fetcher, url, headers);
  if (response.status === 304) {
    if (!previous) throw new GatekeeperError("RIPEstat returned an unsolicited 304", "invalid-response");
    return { kind: "not-modified", validator: responseValidator(response.headers) ?? previous };
  }
  if (!response.ok || !response.body) throw new GatekeeperError(`RIPEstat returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  if (Number(response.headers.get("content-length")) > RIPESTAT_MAX_BYTES) {
    await response.body.cancel("RIPEstat source exceeded its byte bound");
    throw new GatekeeperError("RIPEstat source exceeded its byte bound", "response-too-large");
  }
  const validator = responseValidator(response.headers);
  const nextState: JsonObject = validator ? { url: url.toString(), validators: { default: { ...validator } } } : {};
  if (mode.kind === "history") {
    // Availability lives after the stats array. Buffer only this bounded historical slice
    // to establish the next cursor before declaring its normalized header.
    const bytes = await readBoundedResponse(response, RIPESTAT_MAX_BYTES, "RIPEstat historical slice");
    let root: JsonValue;
    try {
      root = parseJsonBytes(bytes);
    } catch {
      throw new GatekeeperError("RIPEstat historical response is not JSON", "invalid-response");
    }
    const data = envelope(root, name);
    validateCountry(data);
    const earliest = sourceTime(data.earliest_time);
    const latest = sourceTime(data.latest_time);
    if (!Array.isArray(data.stats) || data.resolution !== "1d" || earliest > latest) throw new GatekeeperError("RIPEstat historical availability is invalid", "invalid-response");
    if (!before || !from) throw new GatekeeperError("Missing history bounds", "invalid-config");
    if (sourceTime(data.query_starttime) !== from || sourceTime(data.query_endtime) !== before)
      throw new GatekeeperError("RIPEstat did not honor the requested historical interval", "invalid-response");
    if (before <= earliest) {
      if (data.stats.length > 0) throw new GatekeeperError("RIPEstat returned observations before its availability boundary", "invalid-response");
      return { kind: "exhausted" };
    }
    const next = from > earliest ? from : undefined;
    return {
      kind: "body",
      body: bytes,
      provenance: { sourceUrl: url.toString() },
      completeness: "complete",
      state: {},
      ...(next ? { next: { before: next } } : { exhausted: true }),
    };
  }
  return { kind: "body", body: response.body, provenance: { sourceUrl: url.toString() }, completeness: "complete", state: nextState };
}

export function validateCountry(data: JsonObject): void {
  if (data.resource !== "PT") throw new GatekeeperError("RIPEstat returned data outside Portugal", "invalid-response");
}

function historyBefore(value: string): string {
  let normalized: string;
  try {
    normalized = sourceTime(value);
  } catch {
    throw new GatekeeperError("RIPEstat history cursor must be a valid UTC timestamp", "invalid-config");
  }
  const date = new Date(normalized);
  if (!Number.isFinite(date.getTime()) || date.getUTCHours() !== 0 || date.getUTCMinutes() !== 0 || date.getUTCSeconds() !== 0 || date.getUTCMilliseconds() !== 0)
    throw new GatekeeperError("RIPEstat history cursor must be UTC midnight", "invalid-config");
  return date.toISOString();
}

async function request(fetcher: typeof fetch, url: URL, headers: Headers): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url, { headers, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new GatekeeperError(`RIPEstat request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if ((response.status >= 300 && response.status < 400 && response.status !== 304) || (response.url && new URL(response.url).origin !== url.origin))
    throw new GatekeeperError("RIPEstat redirects are not allowed", "source-denied");
  return response;
}
