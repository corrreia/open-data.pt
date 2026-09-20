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
  reference: {
    kind: "reference",
    title: "WFS reference features",
    description: "A whole feature type of an OGC Web Feature Service, walked page by page as GeoJSON: what each feature is, not when it happened.",
    semantics: { domainSubject: "feature", defaultProductRole: "reference" },
  },
} as const satisfies Record<string, FeedKindDescription>;

/*
 * A reference layer is a standing inventory rather than a window on recent
 * events, so it is read whole. The national fire-prevention layer alone is
 * 22,631 polygons, which is why these bounds are larger than the event ones:
 * the attributes of every feature are the product, and a partial answer would
 * be a different dataset each time it ran.
 */
const WFS_REFERENCE_MAX_FEATURES = 40_000;
const WFS_REFERENCE_MAX_BYTES = 48 * 1024 * 1024;
const WFS_REFERENCE_PAGE_SIZE = 1000;

/** What every WFS read needs, whichever kind it is: where the feature type is and how to name and type a feature. */
interface WfsCommonConfig {
  host: string;
  path: string;
  typeName: string;
  idField: string;
  numberFields: string;
  dateFields: string;
}

export interface WfsEventsConfig extends WfsCommonConfig {
  feed: "events";
  eventTimeField: string;
  sourcePublishedAtField: string;
  countryField: string;
  countryValue: string;
  dateField: string;
  days: string;
}

export interface WfsReferenceConfig extends WfsCommonConfig {
  feed: "reference";
  /** The attributes to ask the service for; omitting the geometry column is how a layer of large outlines is read at all. */
  propertyNames?: string;
  /**
   * One attribute the layer is cut by, and the value to cut at. A Gatekeeper
   * buffers a whole reference layer in memory, so a national layer larger than
   * that budget is read as one feed per region rather than not at all.
   */
  filterField?: string;
  filterValue?: string;
  /**
   * Attributes the service publishes as a calendar day with no time of day.
   * They are typed `date` and kept as the day the source stated; putting them
   * in `dateFields` would promise a timestamp nobody wrote down.
   */
  dateOnlyFields?: string;
}

export type WfsConfig = WfsEventsConfig | WfsReferenceConfig;

export function validateWfsFeedConfig(config: SourceConfig, hosts: ReadonlySet<string>): SourceConfig {
  if (config.feed === "reference") return validateReferenceConfig(config, hosts);
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

/**
 * A reference layer names no time and no country: it is the whole feature type.
 * `propertyNames` is what the service is asked for, so a layer whose outlines
 * run to hundreds of megabytes can be read for its attributes alone.
 */
function validateReferenceConfig(config: SourceConfig, hosts: ReadonlySet<string>): SourceConfig {
  const allowed = ["feed", "host", "path", "typeName", "idField", "propertyNames", "filterField", "filterValue", "numberFields", "dateFields", "dateOnlyFields"];
  for (const key of Object.keys(config)) if (!allowed.includes(key)) throw new GatekeeperError(`Unsupported WFS field: ${key}`, key === "url" ? "source-denied" : "invalid-config");
  const host = config.host?.trim().toLowerCase();
  if (!host || !hosts.has(host)) throw new GatekeeperError("The WFS host is not allowed", "source-denied");
  const path = config.path?.trim();
  if (!path || !/^\/(?!\/)[A-Za-z0-9._~!$&'()*+,;=:@%/-]{1,500}$/u.test(path) || path.includes("..")) throw new GatekeeperError("WFS path is invalid", "invalid-config");
  const normalized: SourceConfig = {
    feed: "reference",
    host,
    path,
    typeName: token(config.typeName, "typeName", /^[A-Za-z0-9_.:-]+$/u),
    idField: token(config.idField, "idField", /^[A-Za-z_][A-Za-z0-9_]*$/u),
  };
  // A reference layer need not carry numbers or dates at all: it is whatever the feature type holds.
  for (const list of ["numberFields", "dateFields", "dateOnlyFields", "propertyNames"] as const) if (config[list] !== undefined) normalized[list] = fieldList(config[list], list);
  if ((config.filterField === undefined) !== (config.filterValue === undefined))
    throw new GatekeeperError("WFS filterField and filterValue are named together or not at all", "invalid-config");
  if (config.filterField !== undefined) {
    normalized.filterField = token(config.filterField, "filterField", /^[A-Za-z_][A-Za-z0-9_]*$/u);
    normalized.filterValue = token(config.filterValue, "filterValue", /^[\p{L}\p{N} _.'-]{1,120}$/u);
  }
  return normalized;
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
  if (validated.feed === "reference") return collectWfsReference(validated, checkpoint, fetcher);
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

/**
 * The whole feature type, page by page. A reference layer has no watermark to
 * catch up to, so a short answer is a broken answer rather than a partial one:
 * the count is read first and every page is required to fill.
 */
async function collectWfsReference(config: WfsReferenceConfig, checkpoint: SourceValidator | undefined, fetcher: typeof fetch): Promise<SourceFetch> {
  const filter = referenceFilterXml(config);
  const hitsUrl = requestUrl(config, filter, { resultType: "hits" });
  const hits = await request(fetcher, hitsUrl, WFS_HITS_BYTES, "WFS count");
  const count = featureCount(new TextDecoder().decode(hits));
  if (count > WFS_REFERENCE_MAX_FEATURES) throw new GatekeeperError(`WFS reference layer holds ${count} features, more than this library reads`, "response-too-large");
  const features: JsonValue[] = [];
  const encoder = new TextEncoder();
  let aggregateBytes = 64;
  for (let start = 0; start < count; start += WFS_REFERENCE_PAGE_SIZE) {
    const size = Math.min(WFS_REFERENCE_PAGE_SIZE, count - start);
    const pageUrl = requestUrl(config, filter, { startIndex: String(start), maxFeatures: String(size), sortBy: config.idField });
    const page = parsePage(await request(fetcher, pageUrl, WFS_PAGE_BYTES, "WFS feature page"));
    if (!isJsonObject(page) || page.type !== "FeatureCollection" || !Array.isArray(page.features)) throw new GatekeeperError("WFS returned malformed GeoJSON", "invalid-response");
    if (page.features.length !== size) throw new GatekeeperError("WFS returned an incomplete feature page", "upstream-error");
    for (const feature of page.features) {
      aggregateBytes += encoder.encode(JSON.stringify(feature)).byteLength + 1;
      if (aggregateBytes > WFS_REFERENCE_MAX_BYTES) throw new GatekeeperError("WFS aggregate response exceeded its byte bound", "response-too-large");
      features.push(feature);
    }
  }
  const bytes = encoder.encode(JSON.stringify({ type: "FeatureCollection", features }));
  const etag = await contentEtag(bytes);
  if (checkpoint?.etag === etag) return { kind: "not-modified", validator: { etag } };
  const sourceUrl = requestUrl(config, filter, {}).toString();
  return { kind: "body", body: bytes, provenance: { sourceUrl }, completeness: "complete", validator: { etag } };
}

function parsePage(bytes: Uint8Array): JsonValue {
  try {
    return parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError("WFS feature page was not valid JSON", "invalid-response");
  }
}

function asWfsConfig(config: SourceConfig): WfsConfig {
  if (config.feed === "reference") return asWfsReferenceConfig(config);
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

function asWfsReferenceConfig(config: SourceConfig): WfsReferenceConfig {
  const { host, path, typeName, idField, numberFields, dateFields, dateOnlyFields, propertyNames, filterField, filterValue } = config;
  if (!host || !path || !typeName || !idField) throw new GatekeeperError("WFS configuration is incomplete", "invalid-config");
  const reference: WfsReferenceConfig = { feed: "reference", host, path, typeName, idField, numberFields: numberFields ?? "", dateFields: dateFields ?? "" };
  if (dateOnlyFields) reference.dateOnlyFields = dateOnlyFields;
  if (propertyNames) reference.propertyNames = propertyNames;
  if (filterField && filterValue) {
    reference.filterField = filterField;
    reference.filterValue = filterValue;
  }
  return reference;
}

function requestUrl(config: WfsConfig, filter: string, extra: Record<string, string>): URL {
  const url = new URL(config.path, `https://${config.host}`);
  url.searchParams.set("service", "WFS");
  url.searchParams.set("request", "GetFeature");
  url.searchParams.set("version", "1.1.0");
  url.searchParams.set("typeName", config.typeName);
  // An unfiltered reference layer is the whole feature type, so it carries no FILTER at all.
  if (filter !== "") url.searchParams.set("FILTER", filter);
  if (config.feed === "reference") {
    // GeoServer answers to the media type, not to MapServer's "geojson" shorthand.
    url.searchParams.set("outputFormat", "application/json");
    if (config.propertyNames) url.searchParams.set("propertyName", config.propertyNames);
  }
  for (const [key, value] of Object.entries(extra)) url.searchParams.set(key, value);
  return url;
}

function filterXml(config: WfsEventsConfig, now: Date): string {
  const threshold = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - Number(config.days) * 86_400_000).toISOString().slice(0, 10);
  return `<ogc:Filter xmlns:ogc="http://www.opengis.net/ogc"><ogc:And><ogc:PropertyIsEqualTo><ogc:PropertyName>${config.countryField}</ogc:PropertyName><ogc:Literal>${escapeXml(config.countryValue)}</ogc:Literal></ogc:PropertyIsEqualTo><ogc:PropertyIsGreaterThanOrEqualTo><ogc:PropertyName>${config.dateField}</ogc:PropertyName><ogc:Literal>${threshold}</ogc:Literal></ogc:PropertyIsGreaterThanOrEqualTo></ogc:And></ogc:Filter>`;
}

/** Empty when the layer is read whole; otherwise the one equality the layer is cut by. */
function referenceFilterXml(config: WfsReferenceConfig): string {
  if (!config.filterField || !config.filterValue) return "";
  return `<ogc:Filter xmlns:ogc="http://www.opengis.net/ogc"><ogc:PropertyIsEqualTo><ogc:PropertyName>${config.filterField}</ogc:PropertyName><ogc:Literal>${escapeXml(config.filterValue)}</ogc:Literal></ogc:PropertyIsEqualTo></ogc:Filter>`;
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
