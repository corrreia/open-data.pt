import {
  GatekeeperError,
  allowedHosts,
  contentEtag,
  isJsonObject,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  type Completeness,
  type FeedKindDescription,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "../../index";

export const WFS_MAX_BYTES = 16 * 1024 * 1024;
const WFS_PAGE_BYTES = 8 * 1024 * 1024;
const WFS_HITS_BYTES = 64 * 1024;
const WFS_PAGE_SIZE = 250;
const WFS_MAX_FEATURES = 5000;

export const WFS_FEEDS = {
  events: {
    kind: "events",
    title: "WFS event features",
    description: "A rolling window of event features from an OGC Web Feature Service, returned as GeoJSON.",
    semantics: { domainSubject: "event", defaultProductRole: "event-log" },
  },
} as const satisfies Record<string, FeedKindDescription>;

export interface WfsConfig {
  feed: "events";
  host: string;
  path: string;
  typeName: string;
  idField: string;
  eventTimeField: string;
  sourcePublishedAtField: string;
  countryField: string;
  countryValue: string;
  dateField: string;
  numberFields: string;
  dateFields: string;
  days: string;
}

export function validateWfsFeedConfig(config: SourceConfig, hosts: ReadonlySet<string>): SourceConfig {
  const allowed = [
    "feed",
    "host",
    "path",
    "typeName",
    "idField",
    "eventTimeField",
    "sourcePublishedAtField",
    "countryField",
    "countryValue",
    "dateField",
    "numberFields",
    "dateFields",
    "days",
  ];
  for (const key of Object.keys(config)) if (!allowed.includes(key)) throw new GatekeeperError(`Unsupported WFS field: ${key}`, key === "url" ? "source-denied" : "invalid-config");
  if (config.feed !== "events") throw new GatekeeperError("WFS requires feed=events", "invalid-config");
  const host = config.host?.trim().toLowerCase();
  if (!host || !hosts.has(host)) throw new GatekeeperError("The WFS host is not allowed", "source-denied");
  const path = config.path?.trim();
  if (!path || !/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,500}$/u.test(path) || path.includes("..")) throw new GatekeeperError("WFS path is invalid", "invalid-config");
  const typeName = token(config.typeName, "typeName", /^[A-Za-z0-9_.:-]+$/u);
  const idField = token(config.idField, "idField", /^[A-Za-z_][A-Za-z0-9_]*$/u);
  const eventTimeField = token(config.eventTimeField, "eventTimeField", /^[A-Za-z_][A-Za-z0-9_]*$/u);
  const sourcePublishedAtField = token(config.sourcePublishedAtField, "sourcePublishedAtField", /^[A-Za-z_][A-Za-z0-9_]*$/u);
  const countryField = token(config.countryField, "countryField", /^[A-Za-z_][A-Za-z0-9_]*$/u);
  const countryValue = token(config.countryValue, "countryValue", /^[A-Za-z0-9 _.-]+$/u);
  const dateField = token(config.dateField, "dateField", /^[A-Za-z_][A-Za-z0-9_]*$/u);
  const numberFields = fieldList(config.numberFields, "numberFields");
  const dateFields = fieldList(config.dateFields, "dateFields");
  const days = integer(config.days, "days", 1, 366);
  return {
    feed: "events",
    host,
    path,
    typeName,
    idField,
    eventTimeField,
    sourcePublishedAtField,
    countryField,
    countryValue,
    dateField,
    numberFields,
    dateFields,
    days: String(days),
  };
}

export function wfsHosts(value: string): ReadonlySet<string> {
  const hosts = allowedHosts(value);
  if (hosts.size === 0) throw new GatekeeperError("WFS_ALLOWED_HOSTS is empty", "source-denied");
  return hosts;
}

export async function collectWfsFeed(
  config: SourceConfig,
  checkpoint: SourceValidator | undefined,
  hosts: ReadonlySet<string>,
  fetcher: typeof fetch,
  now: Date,
): Promise<SourceFetch> {
  const validated = asWfsConfig(validateWfsFeedConfig(config, hosts));
  const filter = filterXml(validated, now);
  const hitsUrl = requestUrl(validated, filter, { resultType: "hits" });
  const hits = await request(fetcher, hitsUrl, WFS_HITS_BYTES, "WFS count");
  const count = featureCount(new TextDecoder().decode(hits));
  const selected = Math.min(count, WFS_MAX_FEATURES);
  const completeness: Completeness = count > selected ? "partial" : "complete";
  const features: JsonValue[] = [];
  const encoder = new TextEncoder();
  let aggregateBytes = 64;
  for (let start = 0; start < selected; start += WFS_PAGE_SIZE) {
    const size = Math.min(WFS_PAGE_SIZE, selected - start);
    const pageUrl = requestUrl(validated, filter, { startIndex: String(start), maxFeatures: String(size), outputFormat: "geojson", sortBy: validated.idField });
    const page = parsePage(await request(fetcher, pageUrl, WFS_PAGE_BYTES, "WFS feature page"));
    if (!isJsonObject(page) || page.type !== "FeatureCollection" || !Array.isArray(page.features)) throw new GatekeeperError("WFS returned malformed GeoJSON", "invalid-response");
    if (page.features.length !== size) throw new GatekeeperError("WFS returned an incomplete feature page", "upstream-error");
    for (const feature of page.features) {
      aggregateBytes += encoder.encode(JSON.stringify(feature)).byteLength + 1;
      if (aggregateBytes > WFS_MAX_BYTES) throw new GatekeeperError("WFS aggregate response exceeded its byte bound", "response-too-large");
      features.push(feature);
    }
  }
  const bytes = encoder.encode(JSON.stringify({ type: "FeatureCollection", features }));
  if (bytes.byteLength > WFS_MAX_BYTES) throw new GatekeeperError("WFS aggregate response exceeded its byte bound", "response-too-large");
  const etag = await contentEtag(bytes);
  if (checkpoint?.etag === etag) return { kind: "not-modified", validator: { etag } };
  const sourceUrl = requestUrl(validated, filter, { outputFormat: "geojson", maxFeatures: String(selected), sortBy: validated.idField }).toString();
  return { kind: "body", body: bytes, provenance: { sourceUrl }, completeness, validator: { etag } };
}

function parsePage(bytes: Uint8Array): JsonValue {
  try {
    return parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError("WFS feature page was not valid JSON", "invalid-response");
  }
}

function asWfsConfig(config: SourceConfig): WfsConfig {
  const { feed, host, path, typeName, idField, eventTimeField, sourcePublishedAtField, countryField, countryValue, dateField, numberFields, dateFields, days } = config;
  if (
    feed !== "events" ||
    !host ||
    !path ||
    !typeName ||
    !idField ||
    !eventTimeField ||
    !sourcePublishedAtField ||
    !countryField ||
    !countryValue ||
    !dateField ||
    !numberFields ||
    !dateFields ||
    !days
  )
    throw new GatekeeperError("WFS configuration is incomplete", "invalid-config");
  return { feed, host, path, typeName, idField, eventTimeField, sourcePublishedAtField, countryField, countryValue, dateField, numberFields, dateFields, days };
}

function requestUrl(config: WfsConfig, filter: string, extra: Record<string, string>): URL {
  const url = new URL(config.path, `https://${config.host}`);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("version", "1.1.0");
  url.searchParams.set("typeName", config.typeName);
  url.searchParams.set("FILTER", filter);
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url;
}

function filterXml(config: WfsConfig, now: Date): string {
  const threshold = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Number(config.days) * 86_400_000).toISOString().slice(0, 10);
  return `<ogc:Filter xmlns:ogc="http://www.opengis.net/ogc"><ogc:And><ogc:PropertyIsEqualTo><ogc:PropertyName>${config.countryField}</ogc:PropertyName><ogc:Literal>${escapeXml(config.countryValue)}</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsGreaterThanOrEqualTo><ogc:PropertyName>${config.dateField}</ogc:PropertyName><ogc:Literal>${threshold}</ogc:Literal></ogc:PropertyIsGreaterThanOrEqualTo></ogc:And></ogc:Filter>`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function featureCount(xml: string): number {
  const match = /numberOfFeatures="(\d+)"/u.exec(xml);
  const count = match?.[1] ? Number(match[1]) : Number.NaN;
  if (!Number.isSafeInteger(count) || count < 0) throw new GatekeeperError("WFS count response omitted numberOfFeatures", "invalid-response");
  return count;
}

async function request(fetcher: typeof fetch, url: URL, maximumBytes: number, label: string): Promise<Uint8Array> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "application/json, application/geo+json, application/xml, text/xml" }, redirect: "manual" });
  } catch (error) {
    throw new GatekeeperError(`${label} request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if ((response.status >= 300 && response.status < 400) || (response.url && new URL(response.url).origin !== url.origin))
    throw new GatekeeperError("WFS redirects are not allowed", "source-denied");
  if (!response.ok) throw new GatekeeperError(`${label} returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  return readBoundedResponse(response, maximumBytes, label);
}

function token(value: string | undefined, name: string, pattern: RegExp): string {
  const text = value?.trim();
  if (!text || text.length > 200 || !pattern.test(text)) throw new GatekeeperError(`WFS ${name} is invalid`, "invalid-config");
  return text;
}

function fieldList(value: string | undefined, name: string): string {
  const fields = value
    ?.split(",")
    .map((field) => field.trim())
    .filter((field) => field !== "");
  if (!fields || fields.length === 0 || fields.length > 100 || fields.some((field) => !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(field)) || new Set(fields).size !== fields.length)
    throw new GatekeeperError(`WFS ${name} is invalid`, "invalid-config");
  return fields.toSorted().join(",");
}

function integer(value: string | undefined, name: string, minimum: number, maximum: number): number {
  if (!value || !/^\d+$/u.test(value)) throw new GatekeeperError(`${name} must be an integer`, "invalid-config");
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new GatekeeperError(`${name} must be ${minimum}..${maximum}`, "invalid-config");
  return parsed;
}
