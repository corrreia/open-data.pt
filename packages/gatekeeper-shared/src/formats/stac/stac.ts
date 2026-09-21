import {
  GatekeeperError,
  isJsonArray,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  streamJsonArray,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
} from "../../index";
import { MAX_ITEM_BYTES } from "./transform";

/** The collection description is read whole, before any item. */
const MAX_METADATA_BYTES = 1024 * 1024;
/** Everything of one items page that is not an item: its `context` and its links. */
const MAX_PAGE_ENVELOPE_BYTES = 256 * 1024;
/** Items per request, unless the configuration names another size. */
const DEFAULT_PAGE_SIZE = 200;
/** Requests per collection, unless the configuration names another number. */
const DEFAULT_MAX_PAGES = 100;
const PAGE_SIZE_LIMIT = 1_000;
const PAGE_COUNT_LIMIT = 600;
const MAX_REDIRECTS = 3;

const CONFIG_KEYS = new Set(["host", "basePath", "collection", "pageSize", "maxPages"]);
/** A STAC collection identifier, which is case-sensitive and may carry dashes. */
const COLLECTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export const STAC_FEEDS = {
  collection: {
    kind: "collection",
    title: "STAC collection",
    description:
      "One collection of a SpatioTemporal Asset Catalog, walked page by page: what each item covers, how it was taken, and where the file behind it is published. The catalogue is read, never the assets themselves.",
    semantics: {
      domainSubject: "reference",
      defaultProductRole: "reference",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

/** What the collected document carries ahead of its items. */
export interface StacCollectionDescription {
  /** The items URL a browser can open; the link the product page shows. */
  itemsUrl: string;
  collectionUrl: string;
  collectionId: string;
  title: string;
  description: string;
  /** The window the collection states it covers, which is the acquisition period. */
  start?: string;
  end?: string;
}

interface ValidatedConfig {
  host: string;
  basePath: string;
  collection: string;
  pageSize: number;
  maxPages: number;
}

export function validateStacFeedConfig(config: SourceConfig, hosts: ReadonlySet<string>): SourceConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new GatekeeperError(`Unknown STAC configuration field: ${key}`, "invalid-config");
  }
  const validated = parseConfig(config, hosts);
  const canonical: SourceConfig = {
    host: validated.host,
    collection: validated.collection,
    pageSize: String(validated.pageSize),
    maxPages: String(validated.maxPages),
  };
  if (validated.basePath !== "") canonical.basePath = validated.basePath;
  return canonical;
}

function parseConfig(config: SourceConfig, hosts: ReadonlySet<string>): ValidatedConfig {
  const collection = (config.collection ?? "").trim();
  if (!COLLECTION_PATTERN.test(collection)) {
    throw new GatekeeperError("collection must match ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$", "invalid-config");
  }
  return {
    host: normalizeHost(config.host ?? "", hosts),
    basePath: normalizeBasePath(config.basePath ?? ""),
    collection,
    pageSize: boundedInteger(config.pageSize, DEFAULT_PAGE_SIZE, PAGE_SIZE_LIMIT, "pageSize"),
    maxPages: boundedInteger(config.maxPages, DEFAULT_MAX_PAGES, PAGE_COUNT_LIMIT, "maxPages"),
  };
}

function normalizeHost(value: string, hosts: ReadonlySet<string>): string {
  const host = value.trim().toLowerCase();
  let url: URL;
  try {
    url = new URL(`https://${host}`);
  } catch {
    throw new GatekeeperError("host must be a hostname without a scheme, path, port, or credentials", "invalid-config");
  }
  if (url.hostname !== host || url.port !== "" || url.username !== "" || url.password !== "" || url.pathname !== "/") {
    throw new GatekeeperError("host must be a hostname without a scheme, path, port, or credentials", "invalid-config");
  }
  if (!hosts.has(host)) throw new GatekeeperError(`Source host ${host} is not allowed`, "source-denied");
  return host;
}

function normalizeBasePath(value: string): string {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, "");
  if (trimmed === "") return "";
  if (trimmed.length > 128) throw new GatekeeperError("basePath is too long", "invalid-config");
  const segments = trimmed.split("/");
  if (segments.length > 4 || segments.some((segment) => !PATH_SEGMENT_PATTERN.test(segment) || segment === "." || segment === "..")) {
    throw new GatekeeperError("basePath must be up to four path segments of letters, digits, dots, dashes, or underscores", "invalid-config");
  }
  return trimmed;
}

function boundedInteger(value: string | undefined, fallback: number, maximum: number, label: string): number {
  const text = value?.trim();
  if (text === undefined || text === "") return fallback;
  if (!/^\d+$/.test(text)) throw new GatekeeperError(`${label} must be an integer between 1 and ${maximum}`, "invalid-config");
  const parsed = Number(text);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new GatekeeperError(`${label} must be an integer between 1 and ${maximum}`, "invalid-config");
  }
  return parsed;
}

/* ---------- URLs, built here from validated identifiers alone ---------- */

function serviceRoot(config: ValidatedConfig): string {
  return config.basePath === "" ? "" : `/${config.basePath}`;
}

export function collectionUrl(config: SourceConfig): URL {
  const validated = unsafeParsed(config);
  return new URL(`${serviceRoot(validated)}/collections/${encodeURIComponent(validated.collection)}`, `https://${validated.host}`);
}

export function itemsUrl(config: SourceConfig, token?: string): URL {
  return buildItemsUrl(unsafeParsed(config), token);
}

function buildItemsUrl(config: ValidatedConfig, token?: string): URL {
  const url = new URL(`${serviceRoot(config)}/collections/${encodeURIComponent(config.collection)}/items`, `https://${config.host}`);
  url.searchParams.set("limit", String(config.pageSize));
  if (token !== undefined && token !== "") url.searchParams.set("token", token);
  return url;
}

function unsafeParsed(config: SourceConfig): ValidatedConfig {
  const collection = (config.collection ?? "").trim();
  if (!COLLECTION_PATTERN.test(collection)) {
    throw new GatekeeperError("collection must match ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$", "invalid-config");
  }
  return {
    host: (config.host ?? "").trim().toLowerCase(),
    basePath: normalizeBasePath(config.basePath ?? ""),
    collection,
    pageSize: boundedInteger(config.pageSize, DEFAULT_PAGE_SIZE, PAGE_SIZE_LIMIT, "pageSize"),
    maxPages: boundedInteger(config.maxPages, DEFAULT_MAX_PAGES, PAGE_COUNT_LIMIT, "maxPages"),
  };
}

/* ---------- Collection ---------- */

/**
 * Read the collection description, then hand back one document whose items are
 * fetched page by page as the normalizer pulls them.
 *
 * A STAC API pages by opaque token rather than by offset, so there is no count
 * to check a walk against and no way to ask how many items a collection holds:
 * completeness is `complete` only when the service stopped offering pages of
 * its own accord, and `partial` when this feed's own page cap ended the walk
 * first. Nothing here dates a row — see the transformer for why the items'
 * `datetime` is the catalogue's clock and not the camera's.
 */
export async function collectStacFeed(config: SourceConfig, _state: JsonObject | undefined, hosts: ReadonlySet<string>, fetcher: Fetcher): Promise<SourceFetch> {
  const validated = parseConfig(validateStacFeedConfig(config, hosts), hosts);
  const collection = collectionUrl(config);
  const described = await readCollection(collection, validated, hosts, fetcher);

  const first = buildItemsUrl(validated);
  const firstResponse = await request(first, itemHeaders(), validated, hosts, fetcher);
  assertUpstream(firstResponse, "items");

  const document: StacCollectionDescription = {
    itemsUrl: first.toString(),
    collectionUrl: collection.toString(),
    collectionId: validated.collection,
    title: described.title,
    description: described.description,
  };
  if (described.start) document.start = described.start;
  if (described.end) document.end = described.end;

  const walk = { truncated: false };
  return {
    kind: "body",
    body: itemDocument(document, items(firstResponse, validated, hosts, fetcher, walk), () => walk.truncated),
    provenance: { sourceUrl: first.toString() },
    // The walk has not run yet; the normalizer downgrades what it turns out to be.
    completeness: "unknown",
    state: {},
  };
}

interface CollectionSummary {
  title: string;
  description: string;
  start?: string;
  end?: string;
}

async function readCollection(url: URL, config: ValidatedConfig, hosts: ReadonlySet<string>, fetcher: Fetcher): Promise<CollectionSummary> {
  const response = await request(url, new Headers({ Accept: "application/json" }), config, hosts, fetcher);
  assertUpstream(response, "collection description");
  const value = parseDocument(await readBoundedResponse(response, MAX_METADATA_BYTES, "STAC collection description"), "collection description");
  if (!isJsonObject(value)) invalid("STAC collection description must be an object");
  // The proxy in front of some catalogues wraps its answers in an envelope.
  const body = isJsonObject(value.data) ? value.data : value;
  if (isJsonString(body.id) && body.id !== config.collection) {
    invalid(`STAC returned collection ${body.id} for ${config.collection}`);
  }
  const summary: CollectionSummary = {
    title: isJsonString(body.title) ? body.title : config.collection,
    description: isJsonString(body.description) ? body.description : "",
  };
  const interval = temporalInterval(body.extent);
  if (interval) {
    if (interval.start) summary.start = interval.start;
    if (interval.end) summary.end = interval.end;
  }
  return summary;
}

/** The window a collection says it covers: for imagery, when it was flown. */
interface AcquisitionWindow {
  start?: string;
  end?: string;
}

function temporalInterval(extent: JsonValue | undefined): AcquisitionWindow | undefined {
  if (!isJsonObject(extent) || !isJsonObject(extent.temporal) || !isJsonArray(extent.temporal.interval)) return undefined;
  const first = extent.temporal.interval[0];
  if (!isJsonArray(first)) return undefined;
  const window: AcquisitionWindow = {};
  if (isJsonString(first[0])) window.start = first[0];
  if (isJsonString(first[1])) window.end = first[1];
  return window;
}

/** `{"type":"FeatureCollection","stac":…,"features":[…]}`, one item per pull. */
function itemDocument(description: StacCollectionDescription, walk: AsyncGenerator<JsonValue>, truncated: () => boolean): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let phase: "prefix" | "items" = "prefix";
  let first = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (phase === "prefix") {
        phase = "items";
        controller.enqueue(encoder.encode(`{"type":"FeatureCollection","stac":${JSON.stringify(description)},"features":[`));
        return;
      }
      const next = await walk.next();
      if (next.done) {
        controller.enqueue(encoder.encode(`],"truncated":${truncated() ? "true" : "false"}}`));
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`${first ? "" : ","}${JSON.stringify(next.value)}`));
      first = false;
      return;
    },
    async cancel() {
      await walk.return(undefined);
    },
  });
}

/**
 * Every item of the collection, page by page. The service's own `next` link
 * decides whether there is another page, but the URL fetched is always rebuilt
 * here from the token that link carries.
 */
async function* items(firstResponse: Response, config: ValidatedConfig, hosts: ReadonlySet<string>, fetcher: Fetcher, walk: { truncated: boolean }): AsyncGenerator<JsonValue> {
  let response = firstResponse;
  let url = buildItemsUrl(config);
  const seen = new Set<string>();
  for (let pageNumber = 0; pageNumber < config.maxPages; pageNumber += 1) {
    const page = openPage(response);
    let count = 0;
    for await (const item of page.items) {
      count += 1;
      const identity = itemIdentity(item);
      if (identity !== undefined) {
        if (seen.has(identity)) invalid(`STAC returned item ${identity} more than once`);
        seen.add(identity);
      }
      yield item;
    }
    const envelope = page.envelope();
    const token = nextToken(envelope, url, config);
    if (token === undefined) return;
    if (count === 0) invalid("STAC offered another page after returning no items");
    if (pageNumber + 1 === config.maxPages) {
      // The cap ended the walk, not the service: the batch is a part of the
      // collection and may not retract what it did not carry.
      walk.truncated = true;
      return;
    }
    url = buildItemsUrl(config, token);
    response = await request(url, itemHeaders(), config, hosts, fetcher);
    assertUpstream(response, "items");
  }
}

function itemIdentity(item: JsonValue): string | undefined {
  if (!isJsonObject(item)) return undefined;
  return isJsonString(item.id) ? item.id : undefined;
}

function itemHeaders(): Headers {
  return new Headers({ Accept: "application/geo+json, application/json" });
}

interface ItemsPage {
  items: AsyncGenerator<JsonValue>;
  envelope(): JsonObject;
}

function openPage(response: Response): ItemsPage {
  if (!response.body) invalid("STAC items returned an empty body");
  // A proxy may wrap the feature collection in `data`; the reader is pointed at
  // whichever of the two shapes carries the features.
  const document = streamJsonArray(response.body, ["data", "features"], {
    maxElementBytes: MAX_ITEM_BYTES,
    maxEnvelopeBytes: MAX_PAGE_ENVELOPE_BYTES,
  });
  return { items: page(document.elements), envelope: () => document.envelope() };
}

async function* page(elements: AsyncIterable<JsonValue>): AsyncGenerator<JsonValue> {
  yield* elements;
}

/**
 * The token of the service's `next` page, or `undefined` when it offered none.
 * The link is evidence, never a destination: only a link to this exact items
 * resource on this exact host is read, and only its token is taken from it.
 */
function nextToken(envelope: JsonObject, current: URL, config: ValidatedConfig): string | undefined {
  const links = isJsonArray(envelope.links) ? envelope.links : isJsonObject(envelope.data) && isJsonArray(envelope.data.links) ? envelope.data.links : undefined;
  if (!links) return undefined;
  const link = links.find((candidate) => isJsonObject(candidate) && candidate.rel === "next");
  if (link === undefined) return undefined;
  if (!isJsonObject(link) || !isJsonString(link.href)) invalid("STAC next link has no href");
  let url: URL;
  try {
    url = new URL(link.href, current);
  } catch {
    invalid("STAC next link is not a URL");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    throw new GatekeeperError("STAC next link is not a plain HTTPS URL", "source-denied");
  }
  if (url.hostname.toLowerCase() !== config.host) {
    throw new GatekeeperError(`STAC next link points at ${url.hostname}, not ${config.host}`, "source-denied");
  }
  if (url.pathname !== current.pathname) {
    throw new GatekeeperError("STAC next link points at another resource", "source-denied");
  }
  const token = url.searchParams.get("token");
  if (token === null || token === "") invalid("STAC next link carries no usable token");
  if (token.length > 512) invalid("STAC next link carries an unreasonable token");
  if (token === current.searchParams.get("token")) invalid("STAC next link did not move forwards");
  return token;
}

async function request(url: URL, headers: Headers, config: ValidatedConfig, hosts: ReadonlySet<string>, fetcher: Fetcher): Promise<Response> {
  const identified = new Headers(headers);
  identified.set("User-Agent", "open-data.pt/1.0 (+https://open-data.pt)");
  let target = url;
  for (let hop = 0; ; hop += 1) {
    const response = await fetcher(target, { headers: identified, redirect: "manual" });
    if (response.status < 300 || response.status > 399) return response;
    await response.body?.cancel("Redirected").catch(() => undefined);
    if (hop >= MAX_REDIRECTS) throw new GatekeeperError("STAC redirected too many times", "upstream-error");
    target = redirectTarget(response.headers.get("location"), target, config, hosts);
  }
}

function redirectTarget(location: string | null, from: URL, config: ValidatedConfig, hosts: ReadonlySet<string>): URL {
  if (location === null || location.trim() === "") {
    throw new GatekeeperError("STAC redirected without a location", "invalid-response");
  }
  let url: URL;
  try {
    url = new URL(location, from);
  } catch {
    throw new GatekeeperError("STAC redirected to an invalid location", "invalid-response");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || !hosts.has(hostname)) {
    throw new GatekeeperError(`STAC redirected to a host that is not allowed: ${url.origin}`, "source-denied");
  }
  const root = `${serviceRoot(config)}/collections/${encodeURIComponent(config.collection)}`;
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) {
    throw new GatekeeperError("STAC redirected away from its own collection", "source-denied");
  }
  return url;
}

function assertUpstream(response: Response, resource: string): void {
  if (!response.ok) {
    throw new GatekeeperError(`STAC ${resource} returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  }
}

function parseDocument(bytes: Uint8Array, label: string): JsonValue {
  try {
    return parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError(`STAC ${label} returned invalid JSON`, "invalid-response");
  }
}

function invalid(message: string): never {
  throw new GatekeeperError(message, "invalid-response");
}
