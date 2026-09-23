import {
  GatekeeperError,
  isJsonArray,
  isJsonNumber,
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
} from "#/index";
import { SeenIdentities } from "./identity";
import { MAX_FEATURE_BYTES } from "./transform";

/** The collection description and the property schema are read whole, before any feature. */
export const MAX_METADATA_BYTES = 1024 * 1024;
/** A `resulttype=hits` answer is an empty feature collection with a count and its links. */
const MAX_HITS_BYTES = 256 * 1024;
/** Everything of one items page that is not a feature: `numberMatched`, `numberReturned` and the links. */
const MAX_PAGE_ENVELOPE_BYTES = 256 * 1024;
/** Features per request, unless the configuration names another size. */
const DEFAULT_PAGE_SIZE = 500;
/** Requests per collection, unless the configuration names another number: politeness, and a bound on the walk. */
const DEFAULT_MAX_PAGES = 100;
const PAGE_SIZE_LIMIT = 5_000;
const PAGE_COUNT_LIMIT = 500;
/** Redirects followed, each one re-validated against the allowlist before it is fetched. */
const MAX_REDIRECTS = 3;
/**
 * Attempts at one page. Walking a national collection takes tens of pages, and
 * this service fails about one in fifty with a 502: without a second try a long
 * walk hardly ever reaches its end, and the whole collection is refused for one
 * bad page. Only a gateway's own answers are tried again — a refusal the
 * service means is repeated, not worked around.
 */
const MAX_PAGE_ATTEMPTS = 3;
/** Waits before each retry, in milliseconds; the service recovers in seconds. */
const RETRY_BACKOFF_MS = [500, 2_000] as const;
/**
 * Times a walk may be picked up again after a page died while its body was
 * being read. Retrying the request covers a gateway that refuses; this covers
 * the connection that closes halfway through a large page, which is what a walk
 * of tens of pages actually runs into.
 */
const MAX_RESUMES = 12;
/** The statuses a gateway returns when it is briefly unable to answer, not when it refuses. */
const TRANSIENT_STATUSES = new Set([429, 500, 502, 503, 504]);

const CONFIG_KEYS = new Set([
  "host",
  "basePath",
  "collection",
  "geometry",
  "properties",
  "filterField",
  "filterValue",
  "shardField",
  "shardSource",
  "shardSourceField",
  "shardsPerRun",
  "pageSize",
  "maxPages",
]);
const COLLECTION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const PROPERTY_PATTERN = /^[A-Za-z0-9_]{1,64}$/;
/** Longest value an attribute may be cut at; the longest real one is a municipality's name. */
const FILTER_VALUE_LIMIT = 128;
/** Shards one run may read, unless the configuration names another number. */
const DEFAULT_SHARDS_PER_RUN = 24;
const SHARDS_PER_RUN_LIMIT = 320;
/** Shard values read from the collection that lists them; 278 municipalities today. */
const MAX_SHARDS = 2_000;
/**
 * Query parameters this library builds itself, which a filter may never name.
 * The filter is written into the URL last, so without this a configuration
 * asking to cut on `limit` would overwrite the page bound, and one asking to cut
 * on `skipGeometry` would pull the outlines a feed declared it leaves behind.
 * These are the OGC API Features parameters plus the ones pygeoapi adds.
 */
const RESERVED_QUERY_PARAMETERS = new Set([
  "bbox",
  "bbox-crs",
  "crs",
  "datetime",
  "f",
  "filter",
  "filter-crs",
  "filter-lang",
  "lang",
  "limit",
  "offset",
  "properties",
  "resulttype",
  "skipgeometry",
  "sortby",
  "token",
]);
const CRS84 = "http://www.opengis.net/def/crs/OGC/1.3/CRS84";
/**
 * The coordinate reference systems a GeoJSON response may be in and still be
 * longitude/latitude on the WGS 84 datum. ETRS89 (EPSG:4258) is deliberately
 * absent: it is a different datum, and labelling it WGS 84 would be a lie even
 * though the two agree to within a metre in Europe today.
 */
const WGS84_CRS = new Set([CRS84, "http://www.opengis.net/def/crs/EPSG/0/4326"]);

export const OGC_FEEDS = {
  collection: {
    kind: "collection",
    title: "OGC API Features collection",
    description: "One collection of an OGC API — Features service, walked page by page as GeoJSON in WGS 84, with the property schema the service publishes.",
    semantics: {
      domainSubject: "feature",
      defaultProductRole: "reference",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

export type Fetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** How the collector waits between attempts; a test passes one that does not. */
export type Sleep = (milliseconds: number) => Promise<void>;

const wait: Sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

/** One property as the service's JSON Schema describes it. */
export interface OgcProperty {
  name: string;
  /** The JSON Schema type: `string`, `number`, `integer`, `boolean`, or `unknown` when the service states none. */
  type: string;
  /** `date`, `date-time`, or absent. */
  format?: string;
  /** `id` when the service marks this property as the feature identifier. */
  role?: string;
}

/** What the collected document carries ahead of its features. */
export interface OgcCollectionDescription {
  /** The items URL a browser can open; the link the product page shows. */
  itemsUrl: string;
  collectionUrl: string;
  collectionId: string;
  title: string;
  description: string;
  keywords: string[];
  /**
   * What is done with the collection's geometry: published as an outline,
   * reduced to the point that places the feature, or never asked for.
   */
  geometry: "include" | "point" | "skip";
  /** The properties the request asked for, when it named a subset. */
  properties?: string[];
  /** `numberMatched` for the whole collection, when the service reported one. */
  expected?: number;
  /** The published property schema, when the service has one. */
  schema?: OgcProperty[];
}

interface ValidatedConfig {
  host: string;
  basePath: string;
  collection: string;
  geometry: "include" | "point" | "skip";
  properties?: string[];
  /**
   * One attribute the collection is cut by, and the value to cut at, sent as
   * the query parameter Part 3 gives a queryable. A national layer too large to
   * read whole is published a region at a time rather than not at all.
   */
  filter?: { field: string; value: string };
  /**
   * How a collection too large for one sitting is read: a few of its shards a
   * run, each shard one value of `field`, and the values themselves read from
   * the collection that lists them. The national land-use charter is 3.4 GB of
   * outlines and half an hour of streaming from a service that drops a
   * connection every few minutes; a municipality of it is twelve megabytes and
   * a few seconds.
   */
  shards?: { field: string; source: string; sourceField: string; perRun: number };
  pageSize: number;
  maxPages: number;
}

/** What one run of a sharded walk covered, kept in the feed's checkpoint. */
interface ShardState {
  /** Where the next run starts in the shard list, so runs work round it in turn. */
  cursor: number;
  /** How many shards the list held when this run read it, for a changed list. */
  shards: number;
  /** The values this run read, so a run can be told what it covered. */
  covered: string[];
}

/** One items page being read: its features, then everything around them. */
interface ItemsPage {
  features: AsyncGenerator<JsonValue>;
  envelope(): JsonObject;
}

export function validateOgcFeedConfig(config: SourceConfig, hosts: ReadonlySet<string>): SourceConfig {
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) {
      throw new GatekeeperError(`Unknown OGC API Features configuration field: ${key}`, "invalid-config");
    }
  }
  const validated = parseConfig(config, hosts);
  const canonical: SourceConfig = {
    host: validated.host,
    collection: validated.collection,
    geometry: validated.geometry,
    pageSize: String(validated.pageSize),
    maxPages: String(validated.maxPages),
  };
  if (validated.basePath !== "") canonical.basePath = validated.basePath;
  if (validated.properties) canonical.properties = validated.properties.join(",");
  if (validated.filter) {
    canonical.filterField = validated.filter.field;
    canonical.filterValue = validated.filter.value;
  }
  if (validated.shards) {
    canonical.shardField = validated.shards.field;
    canonical.shardSource = validated.shards.source;
    canonical.shardSourceField = validated.shards.sourceField;
    canonical.shardsPerRun = String(validated.shards.perRun);
  }
  return canonical;
}

function parseConfig(config: SourceConfig, hosts: ReadonlySet<string>): ValidatedConfig {
  const host = normalizeHost(config.host ?? "", hosts);
  const collection = (config.collection ?? "").trim();
  if (!COLLECTION_PATTERN.test(collection)) {
    throw new GatekeeperError("collection must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", "invalid-config");
  }
  const validated: ValidatedConfig = {
    host,
    basePath: normalizeBasePath(config.basePath ?? ""),
    collection,
    geometry: normalizeGeometry(config.geometry ?? "include"),
    pageSize: boundedInteger(config.pageSize, DEFAULT_PAGE_SIZE, PAGE_SIZE_LIMIT, "pageSize"),
    maxPages: boundedInteger(config.maxPages, DEFAULT_MAX_PAGES, PAGE_COUNT_LIMIT, "maxPages"),
  };
  const properties = normalizeProperties(config.properties);
  if (properties) validated.properties = properties;
  const filter = normalizeFilter(config.filterField, config.filterValue);
  if (filter) validated.filter = filter;
  const shards = normalizeShards(config);
  if (shards) validated.shards = shards;
  return validated;
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

/** The path the service is mounted under, `idea-api` for the Azores, empty for DGT. */
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

/**
 * What a feed does with a collection's geometry.
 *
 * `include` publishes the outline. `skip` never asks for it. `point` asks for
 * it and publishes where the feature is without the shape of it — which is how
 * a layer whose outlines are too large to store is still placed on a map. A
 * district outline is three and a half megabytes and a municipal reserve eight;
 * the point that stands for either is two numbers.
 */
function normalizeGeometry(value: string): "include" | "point" | "skip" {
  const geometry = value.trim().toLowerCase();
  if (geometry === "include" || geometry === "point" || geometry === "skip") return geometry;
  throw new GatekeeperError("geometry must be include, point or skip", "invalid-config");
}

function normalizeProperties(value: string | undefined): string[] | undefined {
  const text = value?.trim();
  if (text === undefined || text === "") return undefined;
  if (text.length > 1024) throw new GatekeeperError("properties is too long", "invalid-config");
  const names = text.split(",").map((name) => name.trim());
  if (names.length > 64 || names.some((name) => !PROPERTY_PATTERN.test(name))) {
    throw new GatekeeperError("properties must be up to 64 comma-separated property names", "invalid-config");
  }
  return [...new Set(names)];
}

/**
 * The attribute a collection is cut by and the value to cut at, which only mean
 * anything together. The value is sent as a query parameter named for the
 * attribute, so it is bounded and kept to printable characters on one line; the
 * service decides whether the attribute is queryable at all.
 */
function normalizeFilter(field: string | undefined, value: string | undefined): { field: string; value: string } | undefined {
  const name = field?.trim() ?? "";
  const wanted = value?.trim() ?? "";
  if (name === "" && wanted === "") return undefined;
  if (name === "" || wanted === "") {
    throw new GatekeeperError("filterField and filterValue are given together or not at all", "invalid-config");
  }
  if (!PROPERTY_PATTERN.test(name)) {
    throw new GatekeeperError("filterField must be a property name of letters, digits, or underscores", "invalid-config");
  }
  if (RESERVED_QUERY_PARAMETERS.has(name.toLowerCase())) {
    throw new GatekeeperError(`filterField may not be ${name}: this library builds that query parameter itself`, "invalid-config");
  }
  if (wanted.length > FILTER_VALUE_LIMIT || hasControlCharacter(wanted)) {
    throw new GatekeeperError(`filterValue must be at most ${FILTER_VALUE_LIMIT} printable characters on one line`, "invalid-config");
  }
  return { field: name, value: wanted };
}

function hasControlCharacter(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}

/**
 * The four parts of a sharded read, which only mean anything together: the
 * attribute to cut the collection by, the collection that lists the values to
 * cut at, the field there that holds them, and how many to read in one run.
 */
function normalizeShards(config: SourceConfig): ValidatedConfig["shards"] {
  const field = config.shardField?.trim() ?? "";
  const source = config.shardSource?.trim() ?? "";
  const sourceField = config.shardSourceField?.trim() ?? "";
  const perRunText = config.shardsPerRun?.trim() ?? "";
  if (field === "" && source === "" && sourceField === "" && perRunText === "") return undefined;
  if (field === "" || source === "" || sourceField === "") {
    throw new GatekeeperError("shardField, shardSource and shardSourceField are given together or not at all", "invalid-config");
  }
  if (config.filterField !== undefined) {
    throw new GatekeeperError("a sharded read cuts the collection itself, so it may not also carry filterField", "invalid-config");
  }
  if (!PROPERTY_PATTERN.test(field) || !PROPERTY_PATTERN.test(sourceField)) {
    throw new GatekeeperError("shardField and shardSourceField must be property names of letters, digits, or underscores", "invalid-config");
  }
  if (RESERVED_QUERY_PARAMETERS.has(field.toLowerCase())) {
    throw new GatekeeperError(`shardField may not be ${field}: this library builds that query parameter itself`, "invalid-config");
  }
  if (!COLLECTION_PATTERN.test(source)) {
    throw new GatekeeperError("shardSource must be a collection identifier", "invalid-config");
  }
  return { field, source, sourceField, perRun: boundedInteger(config.shardsPerRun, DEFAULT_SHARDS_PER_RUN, SHARDS_PER_RUN_LIMIT, "shardsPerRun") };
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

/* ---------- URLs: every one of them built here, from validated identifiers ---------- */

function serviceRoot(config: ValidatedConfig): string {
  return config.basePath === "" ? "" : `/${config.basePath}`;
}

export function collectionUrl(config: SourceConfig): URL {
  const validated = unsafeParsed(config);
  const url = new URL(`${serviceRoot(validated)}/collections/${encodeURIComponent(validated.collection)}`, `https://${validated.host}`);
  url.searchParams.set("f", "json");
  return url;
}

function schemaUrl(config: ValidatedConfig): URL {
  const url = new URL(`${serviceRoot(config)}/collections/${encodeURIComponent(config.collection)}/schema`, `https://${config.host}`);
  url.searchParams.set("f", "json");
  return url;
}

/** The items URL for one page. `offset` is left out of the first page so the URL a browser opens is the plain one. */
export function itemsUrl(config: SourceConfig, offset?: number): URL {
  const validated = unsafeParsed(config);
  return buildItemsUrl(validated, offset);
}

function buildItemsUrl(config: ValidatedConfig, offset?: number): URL {
  const url = new URL(`${serviceRoot(config)}/collections/${encodeURIComponent(config.collection)}/items`, `https://${config.host}`);
  url.searchParams.set("f", "json");
  url.searchParams.set("limit", String(config.pageSize));
  if (offset !== undefined && offset > 0) url.searchParams.set("offset", String(offset));
  if (config.geometry === "skip") url.searchParams.set("skipGeometry", "true");
  // Ask for CRS84 by name when geometry is coming back, rather than trusting the
  // service's default. Both services advertise it; Part 2 says a server that
  // does not support a requested CRS must refuse rather than substitute one.
  else url.searchParams.set("crs", CRS84);
  if (config.properties) url.searchParams.set("properties", config.properties.join(","));
  if (config.filter) url.searchParams.set(config.filter.field, config.filter.value);
  return url;
}

/**
 * The cheap count query: an empty feature collection carrying `numberMatched`.
 * It carries the feed's own filter, so what it counts is what the pages will
 * return — counting the whole collection would call a complete subset partial.
 */
function hitsUrl(config: ValidatedConfig): URL {
  const url = new URL(`${serviceRoot(config)}/collections/${encodeURIComponent(config.collection)}/items`, `https://${config.host}`);
  url.searchParams.set("f", "json");
  url.searchParams.set("resulttype", "hits");
  if (config.filter) url.searchParams.set(config.filter.field, config.filter.value);
  return url;
}

/**
 * A configuration that has already been through `validateOgcFeedConfig`. The
 * collector re-parses it without an allowlist because the resolver enforced one.
 */
function unsafeParsed(config: SourceConfig): ValidatedConfig {
  const host = (config.host ?? "").trim().toLowerCase();
  const validated: ValidatedConfig = {
    host,
    basePath: normalizeBasePath(config.basePath ?? ""),
    collection: (config.collection ?? "").trim(),
    geometry: normalizeGeometry(config.geometry ?? "include"),
    pageSize: boundedInteger(config.pageSize, DEFAULT_PAGE_SIZE, PAGE_SIZE_LIMIT, "pageSize"),
    maxPages: boundedInteger(config.maxPages, DEFAULT_MAX_PAGES, PAGE_COUNT_LIMIT, "maxPages"),
  };
  if (!COLLECTION_PATTERN.test(validated.collection)) {
    throw new GatekeeperError("collection must match ^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$", "invalid-config");
  }
  const properties = normalizeProperties(config.properties);
  if (properties) validated.properties = properties;
  const filter = normalizeFilter(config.filterField, config.filterValue);
  if (filter) validated.filter = filter;
  const shards = normalizeShards(config);
  if (shards) validated.shards = shards;
  return validated;
}

/* ---------- Collection ---------- */

/**
 * Read the collection description, its published property schema and its total
 * count, then hand back one GeoJSON document whose features are fetched page by
 * page as the normalizer pulls them. Completeness is decided here, before the
 * first feature, from `numberMatched`: a collection larger than
 * `pageSize × maxPages` is collected as a partial snapshot, and a service that
 * reports no total at all yields `unknown` rather than a promise it cannot keep.
 *
 * There is deliberately no conditional request. A validator covers one items
 * response, and this feed's scope is the collection plus its description and
 * its published schema; a page-one ETag proves nothing about page two, about a
 * collection that grew since the last run, or about a renamed property. These
 * are weekly and monthly reference layers, so the saving would be small and the
 * risk — a silently missed page — is exactly the failure this library exists to
 * avoid. The kernel's semantic no-op suppression already makes an unchanged
 * collection cost no revision, no history row and no stored chunk.
 */
/**
 * A collection read a few shards at a time.
 *
 * Every run reads the list of shard values, takes the next few after where the
 * last run stopped, and walks each one whole. What comes back is a part of the
 * collection and says so: the kernel merges a partial snapshot into what is
 * already served instead of replacing it, so the shards pile up into one
 * dataset across runs and nothing is retracted for being absent from a run
 * that never asked for it.
 *
 * The price of that is the price of any partial snapshot: this walk cannot
 * express a deletion. What decides whether a feature still exists is the feed
 * that reads the same collection whole, every row of it and no outlines, which
 * is small enough to finish in one sitting and authoritative when it does.
 */
async function collectShardedFeed(validated: ValidatedConfig, state: JsonObject | undefined, hosts: ReadonlySet<string>, fetcher: Fetcher, sleep: Sleep): Promise<SourceFetch> {
  const shards = validated.shards;
  if (!shards) throw new GatekeeperError("A sharded read was asked for without shards", "invalid-config");

  const values = await readShardValues(validated, shards, hosts, fetcher, sleep);
  const taken = shardsForRun(values, shards.perRun, state);

  const collection = collectionUrl(shardConfigToSource(validated));
  const described = await readCollection(collection, validated, hosts, fetcher);
  const schema = await readSchema(validated, hosts, fetcher);
  const browsable = buildItemsUrl(validated);

  const document: OgcCollectionDescription = {
    itemsUrl: browsable.toString(),
    collectionUrl: collection.toString(),
    collectionId: validated.collection,
    title: described.title,
    description: described.description,
    keywords: described.keywords,
    geometry: validated.geometry,
  };
  if (validated.properties) document.properties = validated.properties;
  if (schema) document.schema = schema;

  const next: ShardState = { cursor: (taken.cursor + taken.values.length) % Math.max(values.length, 1), shards: values.length, covered: taken.values };
  return {
    kind: "body",
    body: featureDocument(document, shardFeatures(validated, shards, taken.values, hosts, fetcher, sleep)),
    provenance: { sourceUrl: browsable.toString() },
    // A part of the collection, always: what this run did not ask for is not
    // missing, and the kernel must not read its absence as a deletion.
    completeness: "partial",
    state: { cursor: next.cursor, shards: next.shards, covered: next.covered },
  };
}

/** A copy of the configuration as the string map the URL builders take. */
function shardConfigToSource(validated: ValidatedConfig): SourceConfig {
  const config: SourceConfig = {
    host: validated.host,
    collection: validated.collection,
    geometry: validated.geometry,
    pageSize: String(validated.pageSize),
    maxPages: String(validated.maxPages),
  };
  if (validated.basePath !== "") config.basePath = validated.basePath;
  if (validated.properties) config.properties = validated.properties.join(",");
  return config;
}

/**
 * The values the collection is sharded by, read from the collection that lists
 * them. For the land-use charter that is the administrative charter's own
 * municipality codes, which is what keeps the list right when a municipality is
 * added or renamed.
 */
async function readShardValues(
  validated: ValidatedConfig,
  shards: NonNullable<ValidatedConfig["shards"]>,
  hosts: ReadonlySet<string>,
  fetcher: Fetcher,
  sleep: Sleep,
): Promise<string[]> {
  const listing: ValidatedConfig = {
    host: validated.host,
    basePath: validated.basePath,
    collection: shards.source,
    geometry: "skip",
    properties: [shards.sourceField],
    pageSize: Math.min(PAGE_SIZE_LIMIT, 1_000),
    maxPages: Math.ceil(MAX_SHARDS / 1_000) + 1,
  };
  const expected = await readTotal(listing, hosts, fetcher);
  const first = buildItemsUrl(listing);
  const response = await requestPage(first, itemHeaders(), listing, hosts, fetcher, sleep);
  assertUpstream(response, "shard values");

  const values: string[] = [];
  // The listing is walked the way any other collection is, so a source of more
  // than one page is read whole. A shard left behind here is never read at all,
  // and nothing downstream could tell that it was missing.
  for await (const feature of features(response, listing, expected, listing.pageSize * listing.maxPages, hosts, fetcher, sleep)) {
    if (!isJsonObject(feature) || !isJsonObject(feature.properties)) continue;
    const held = feature.properties[shards.sourceField];
    const text = isJsonString(held) ? held.trim() : isJsonNumber(held) ? String(held) : "";
    if (text !== "" && text.length <= FILTER_VALUE_LIMIT && !hasControlCharacter(text)) values.push(text);
    if (values.length > MAX_SHARDS) invalid(`OGC API Features shard listing holds more than the ${MAX_SHARDS} shards one feed may work through`);
  }

  const unique = [...new Set(values)].toSorted();
  if (unique.length === 0) invalid("OGC API Features shard listing held no usable values");
  return unique;
}

/** Where this run starts, and the shards it takes, working round the list in turn. */
interface ShardsTaken {
  /** The place in the list this run began at. */
  cursor: number;
  /** The values it takes, in the order it will read them. */
  values: string[];
}

function shardsForRun(values: string[], perRun: number, state: JsonObject | undefined): ShardsTaken {
  const held = isJsonNumber(state?.cursor) && Number.isSafeInteger(state.cursor) && state.cursor >= 0 ? state.cursor : 0;
  // A list that shrank leaves the cursor past its end; start again rather than read nothing.
  const cursor = held < values.length ? held : 0;
  const taken: string[] = [];
  for (let step = 0; step < Math.min(perRun, values.length); step += 1) {
    const value = values[(cursor + step) % values.length];
    if (value !== undefined) taken.push(value);
  }
  return { cursor, values: taken };
}

/** Every feature of every shard this run took, one shard walked whole at a time. */
async function* shardFeatures(
  validated: ValidatedConfig,
  shards: NonNullable<ValidatedConfig["shards"]>,
  values: string[],
  hosts: ReadonlySet<string>,
  fetcher: Fetcher,
  sleep: Sleep,
): AsyncGenerator<JsonValue> {
  for (const value of values) {
    const shard: ValidatedConfig = { ...validated, filter: { field: shards.field, value } };
    const expected = await readTotal(shard, hosts, fetcher);
    const cap = shard.pageSize * shard.maxPages;
    const first = buildItemsUrl(shard);
    const response = await requestPage(first, itemHeaders(), shard, hosts, fetcher, sleep);
    assertUpstream(response, "items");
    assertWgs84(response.headers, shard);
    yield* features(response, shard, expected, cap, hosts, fetcher, sleep);
  }
}

export async function collectOgcFeed(config: SourceConfig, state: JsonObject | undefined, hosts: ReadonlySet<string>, fetcher: Fetcher, sleep: Sleep = wait): Promise<SourceFetch> {
  const validated = parseConfig(validateOgcFeedConfig(config, hosts), hosts);
  if (validated.shards) return collectShardedFeed(validated, state, hosts, fetcher, sleep);
  const collection = collectionUrl(config);
  const description = await readCollection(collection, validated, hosts, fetcher);
  const schema = await readSchema(validated, hosts, fetcher);

  const expected = await readTotal(validated, hosts, fetcher);
  const cap = validated.pageSize * validated.maxPages;
  const first = buildItemsUrl(validated);
  const firstResponse = await requestPage(first, itemHeaders(), validated, hosts, fetcher, sleep);
  if (firstResponse.status === 304) {
    await firstResponse.body?.cancel("Unsolicited not-modified").catch(() => undefined);
    invalid("OGC API Features answered 304 to an unconditional request");
  }
  assertUpstream(firstResponse, "items");
  assertWgs84(firstResponse.headers, validated);

  const document: OgcCollectionDescription = {
    itemsUrl: first.toString(),
    collectionUrl: collection.toString(),
    collectionId: validated.collection,
    title: description.title,
    description: description.description,
    keywords: description.keywords,
    geometry: validated.geometry,
  };
  if (validated.properties) document.properties = validated.properties;
  if (expected !== undefined) document.expected = expected;
  if (schema) document.schema = schema;

  return {
    kind: "body",
    body: featureDocument(document, features(firstResponse, validated, expected, cap, hosts, fetcher, sleep)),
    provenance: { sourceUrl: first.toString() },
    completeness: expected === undefined ? "unknown" : expected <= cap ? "complete" : "partial",
    // Neither service publishes a modification time, so nothing here may date a
    // row: the poll time is not a source clock. No validator is carried, so the
    // checkpoint keeps no transport state at all.
    state: {},
  };
}

interface CollectionSummary {
  title: string;
  description: string;
  keywords: string[];
}

async function readCollection(url: URL, config: ValidatedConfig, hosts: ReadonlySet<string>, fetcher: Fetcher): Promise<CollectionSummary> {
  const response = await request(url, new Headers({ Accept: "application/json" }), config, hosts, fetcher);
  assertUpstream(response, "collection description");
  const value = parseDocument(await readBoundedResponse(response, MAX_METADATA_BYTES, "OGC API Features collection description"), "collection description");
  if (!isJsonObject(value)) invalid("OGC API Features collection description must be an object");
  if (isJsonString(value.id) && value.id !== config.collection) {
    invalid(`OGC API Features returned collection ${value.id} for ${config.collection}`);
  }
  if (isJsonString(value.itemType) && value.itemType !== "feature") {
    invalid(`OGC API Features collection ${config.collection} holds ${value.itemType}, not features`);
  }
  assertWgs84Collection(value, config);
  return {
    title: isJsonString(value.title) ? value.title : config.collection,
    description: isJsonString(value.description) ? value.description : "",
    keywords: isJsonArray(value.keywords) ? value.keywords.filter(isJsonString).slice(0, 32) : [],
  };
}

/** Part 5 publishes a JSON Schema per collection; a service without one is normalized from its features. */
async function readSchema(config: ValidatedConfig, hosts: ReadonlySet<string>, fetcher: Fetcher): Promise<OgcProperty[] | undefined> {
  const response = await request(schemaUrl(config), new Headers({ Accept: "application/schema+json, application/json" }), config, hosts, fetcher);
  if (!response.ok) {
    await response.body?.cancel("No published schema").catch(() => undefined);
    return undefined;
  }
  const value = parseDocument(await readBoundedResponse(response, MAX_METADATA_BYTES, "OGC API Features schema"), "schema");
  if (!isJsonObject(value) || !isJsonObject(value.properties)) return undefined;
  const properties: OgcProperty[] = [];
  for (const [name, member] of Object.entries(value.properties)) {
    if (!isJsonObject(member)) continue;
    if (isJsonString(member.format) && member.format.startsWith("geometry-")) continue;
    if (isJsonString(member["x-ogc-role"]) && member["x-ogc-role"] === "primary-geometry") continue;
    if (config.properties && !config.properties.includes(name)) continue;
    const property: OgcProperty = { name, type: isJsonString(member.type) ? member.type : "unknown" };
    if (isJsonString(member.format)) property.format = member.format;
    if (isJsonString(member["x-ogc-role"])) property.role = member["x-ogc-role"];
    properties.push(property);
    if (properties.length >= 512) break;
  }
  return properties.length > 0 ? properties : undefined;
}

/**
 * `numberMatched` for the whole collection, from the count query every
 * pygeoapi service answers. A service that does not is collected with
 * `unknown` completeness, so its omissions never retract anything.
 */
async function readTotal(config: ValidatedConfig, hosts: ReadonlySet<string>, fetcher: Fetcher): Promise<number | undefined> {
  const response = await request(hitsUrl(config), new Headers({ Accept: "application/geo+json, application/json" }), config, hosts, fetcher);
  if (!response.ok) {
    await response.body?.cancel("No count query").catch(() => undefined);
    return undefined;
  }
  const value = parseDocument(await readBoundedResponse(response, MAX_HITS_BYTES, "OGC API Features count"), "count");
  if (!isJsonObject(value)) return undefined;
  // A service that ignored `resulttype` answered with real features; its count is not a count of the collection.
  if (isJsonArray(value.features) && value.features.length > 0) return undefined;
  const matched = value.numberMatched;
  return isJsonNumber(matched) && Number.isSafeInteger(matched) && matched >= 0 ? matched : undefined;
}

/** `{"type":"FeatureCollection","ogc":…,"features":[…]}`, one feature per pull. */
function featureDocument(description: OgcCollectionDescription, items: AsyncGenerator<JsonValue>): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let phase: "prefix" | "features" = "prefix";
  let first = true;
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (phase === "prefix") {
        phase = "features";
        controller.enqueue(encoder.encode(`{"type":"FeatureCollection","ogc":${JSON.stringify(description)},"features":[`));
        return;
      }
      const next = await items.next();
      if (next.done) {
        controller.enqueue(encoder.encode("]}"));
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`${first ? "" : ","}${JSON.stringify(next.value)}`));
      first = false;
    },
    async cancel() {
      await items.return(undefined);
    },
  });
}

/**
 * Every feature of the collection, page by page: the first page's response is
 * already open, each later one is requested only once the previous is used up.
 * The service's own `next` link decides whether there is another page, but the
 * URL fetched is always rebuilt here from the offset that link carries.
 */
async function* features(
  firstResponse: Response,
  config: ValidatedConfig,
  expected: number | undefined,
  cap: number,
  hosts: ReadonlySet<string>,
  fetcher: Fetcher,
  sleep: Sleep,
): AsyncGenerator<JsonValue> {
  let response = firstResponse;
  let url = buildItemsUrl(config);
  let offset = 0;
  let yielded = 0;
  let resumes = 0;
  /*
   * Feature identities seen so far, so a member repeated across pages cannot
   * make up the count of one that was dropped when the collection shifted under
   * the walk. Each is held as a digest, so a national collection costs a few
   * megabytes rather than the tens its keys would.
   */
  const seen = new SeenIdentities(PAGE_SIZE_LIMIT * PAGE_COUNT_LIMIT);
  for (let pageNumber = 0; pageNumber < config.maxPages; pageNumber += 1) {
    let page = openPage(response);
    let count = 0;
    /*
     * Read this page, and if the connection dies partway through it, ask again
     * from the feature it died on rather than losing the whole walk. Offsets
     * make that exact: what has been read is `offset + count`, so the next
     * request starts there and the page that follows is counted from there.
     */
    for (;;) {
      try {
        for await (const feature of page.features) {
          count += 1;
          yielded += 1;
          // Never truncate to a stale count: a collection that grew between the
          // count query and this page is reported, not quietly cut to fit.
          if (yielded > cap) invalid(`OGC API Features returned more than the ${cap} features this feed may read`);
          if (expected !== undefined && yielded > expected) {
            invalid(`OGC API Features returned more features than the ${expected} it counted; the collection changed while it was being read`);
          }
          const identity = featureIdentity(feature);
          if (identity !== undefined) {
            if (seen.has(identity)) invalid(`OGC API Features returned feature ${identity} more than once`);
            seen.add(identity);
          }
          yield feature;
        }
        break;
      } catch (error) {
        // A refusal this library made is final; only the connection is retried.
        if (error instanceof GatekeeperError) throw error;
        resumes += 1;
        if (resumes > MAX_RESUMES) {
          throw new GatekeeperError(`OGC API Features lost its connection ${resumes} times while reading one collection`, "upstream-error");
        }
        await sleep(RETRY_BACKOFF_MS[Math.min(resumes, RETRY_BACKOFF_MS.length) - 1] ?? 2_000);
        offset += count;
        count = 0;
        url = buildItemsUrl(config, offset);
        response = await requestPage(url, itemHeaders(), config, hosts, fetcher, sleep);
        assertUpstream(response, "items");
        assertWgs84(response.headers, config);
        page = openPage(response);
      }
    }
    // The envelope is only complete once every feature of the page was read, so
    // this check happens on every page, including the last one.
    const envelope = page.envelope();
    const returned = envelope.numberReturned;
    if (isJsonNumber(returned) && Number.isSafeInteger(returned) && returned !== count) {
      invalid(`OGC API Features page reported ${returned} features and returned ${count}`);
    }
    const next = nextOffset(envelope, url, offset, config);
    if (next === undefined) {
      // The walk ended on the service's own terms. A short collection is one
      // that changed since it was counted; the normalizer downgrades it.
      return;
    }
    // The service promised another page; an empty one that still promises more is a loop.
    if (count === 0) invalid("OGC API Features offered another page after returning no features");
    /*
     * Having read exactly what the service counted is not a reason to stop
     * here. pygeoapi links a next page from the last full one whenever the
     * count divides evenly by the page size — offset 192 of 192 — and that page
     * is empty, ends the walk on the service's own terms, and is the cheapest
     * request of the run. Reading it is also the only way to tell that courtesy
     * from a collection that grew since it was counted: if features come back,
     * the per-feature check above refuses them rather than truncating quietly.
     */
    if (pageNumber + 1 === config.maxPages) {
      if (expected !== undefined && expected <= cap) {
        invalid("OGC API Features offered more pages than the count it reported allows");
      }
      // A declared partial cap must not fetch an extra page that will never be consumed.
      return;
    }
    offset = next;
    url = buildItemsUrl(config, offset);
    response = await requestPage(url, itemHeaders(), config, hosts, fetcher, sleep);
    assertUpstream(response, "items");
    assertWgs84(response.headers, config);
  }
}

/** A feature's own identity, for the duplicate check; a service that omits `id` gets no check. */
function featureIdentity(feature: JsonValue): string | undefined {
  if (!isJsonObject(feature)) return undefined;
  if (isJsonString(feature.id)) return feature.id;
  if (isJsonNumber(feature.id) && Number.isFinite(feature.id)) return String(feature.id);
  return undefined;
}

function itemHeaders(): Headers {
  return new Headers({ Accept: "application/geo+json, application/json" });
}

function openPage(response: Response): ItemsPage {
  if (!response.body) invalid("OGC API Features items returned an empty body");
  const document = streamJsonArray(response.body, ["features"], {
    maxElementBytes: MAX_FEATURE_BYTES,
    maxEnvelopeBytes: MAX_PAGE_ENVELOPE_BYTES,
  });
  return { features: page(document.elements), envelope: () => document.envelope() };
}

async function* page(elements: AsyncIterable<JsonValue>): AsyncGenerator<JsonValue> {
  yield* elements;
}

/**
 * The offset of the service's `next` page, or `undefined` when it offered none.
 * The link is evidence, never a destination: only a link to this exact items
 * resource on this exact host is read, and only its `offset` is taken from it.
 */
function nextOffset(envelope: JsonObject, current: URL, currentOffset: number, config: ValidatedConfig): number | undefined {
  if (!isJsonArray(envelope.links)) return undefined;
  const link = envelope.links.find((candidate) => isJsonObject(candidate) && candidate.rel === "next");
  if (link === undefined) return undefined;
  if (!isJsonObject(link) || !isJsonString(link.href)) invalid("OGC API Features next link has no href");
  let url: URL;
  try {
    url = new URL(link.href, current);
  } catch {
    invalid("OGC API Features next link is not a URL");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    throw new GatekeeperError("OGC API Features next link is not a plain HTTPS URL", "source-denied");
  }
  if (url.hostname.toLowerCase() !== config.host) {
    throw new GatekeeperError(`OGC API Features next link points at ${url.hostname}, not ${config.host}`, "source-denied");
  }
  if (url.pathname !== current.pathname) {
    throw new GatekeeperError("OGC API Features next link points at another resource", "source-denied");
  }
  const offsetText = url.searchParams.get("offset");
  if (offsetText === null || !/^\d+$/.test(offsetText)) invalid("OGC API Features next link carries no usable offset");
  const offset = Number(offsetText);
  if (!Number.isSafeInteger(offset) || offset <= currentOffset) invalid("OGC API Features next link did not move forwards");
  return offset;
}

/**
 * One request, following at most a few redirects, each of which is checked
 * against the allowlist and this service's own path before it is fetched.
 */
/**
 * One page, tried again when the gateway briefly fails it or the connection
 * does. Walking a national collection takes tens of pages, and a single page
 * that times out or answers 502 would otherwise refuse the whole collection.
 *
 * Only what the network and the gateway do by accident is retried. A refusal
 * this library made itself — a redirect off the allowlist, a host that is not
 * allowed — is a `GatekeeperError` and is raised as it is, because trying it
 * again would only arrive at the same answer.
 */
async function requestPage(url: URL, headers: Headers, config: ValidatedConfig, hosts: ReadonlySet<string>, fetcher: Fetcher, sleep: Sleep): Promise<Response> {
  for (let attempt = 1; ; attempt += 1) {
    const last = attempt >= MAX_PAGE_ATTEMPTS;
    let response: Response;
    try {
      response = await request(url, headers, config, hosts, fetcher);
    } catch (error) {
      if (last || error instanceof GatekeeperError) throw error;
      await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 2_000);
      continue;
    }
    if (response.ok || !TRANSIENT_STATUSES.has(response.status) || last) return response;
    await response.body?.cancel("Retrying").catch(() => undefined);
    await sleep(RETRY_BACKOFF_MS[attempt - 1] ?? 2_000);
  }
}

async function request(url: URL, headers: Headers, config: ValidatedConfig, hosts: ReadonlySet<string>, fetcher: Fetcher): Promise<Response> {
  let target = url;
  for (let hop = 0; ; hop += 1) {
    const response = await fetcher(target, { headers, redirect: "manual" });
    if (response.status >= 400)
      console.warn(
        JSON.stringify({
          event: "source_http_status",
          source: "ogc",
          host: target.hostname,
          path: target.pathname,
          status: response.status,
          server: response.headers.get("server"),
          mitigation: response.headers.get("cf-mitigated"),
          contentType: response.headers.get("content-type"),
        }),
      );
    if (response.status < 300 || response.status > 399 || response.status === 304) return response;
    await response.body?.cancel("Redirected").catch(() => undefined);
    if (hop >= MAX_REDIRECTS) {
      throw new GatekeeperError("OGC API Features redirected too many times", "upstream-error");
    }
    target = redirectTarget(response.headers.get("location"), target, config, hosts);
  }
}

function redirectTarget(location: string | null, from: URL, config: ValidatedConfig, hosts: ReadonlySet<string>): URL {
  if (location === null || location.trim() === "") {
    throw new GatekeeperError("OGC API Features redirected without a location", "invalid-response");
  }
  let url: URL;
  try {
    url = new URL(location, from);
  } catch {
    throw new GatekeeperError("OGC API Features redirected to an invalid location", "invalid-response");
  }
  const hostname = url.hostname.toLowerCase();
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "" || !hosts.has(hostname)) {
    throw new GatekeeperError(`OGC API Features redirected to a host that is not allowed: ${url.origin}`, "source-denied");
  }
  const root = `${serviceRoot(config)}/collections/${encodeURIComponent(config.collection)}`;
  // A bare prefix test would accept a sibling whose name merely starts with this
  // one — `/collections/municipios2` for `/collections/municipios`. Only this
  // collection itself, or something beneath it, is its own resource.
  if (url.pathname !== root && !url.pathname.startsWith(`${root}/`)) {
    throw new GatekeeperError("OGC API Features redirected away from its own collection", "source-denied");
  }
  return url;
}

/**
 * The response's own `Content-Crs`: emitted GeoJSON coordinates must be
 * longitude and latitude on WGS 84. A feed that asked for `skipGeometry` emits
 * no coordinates at all, so the header is irrelevant to what it publishes — DGT
 * answers its attributes-only responses with the storage CRS, and refusing that
 * would refuse a perfectly good attribute table.
 */
function assertWgs84(headers: Headers, config: ValidatedConfig): void {
  if (config.geometry === "skip") return;
  const declared = headers.get("content-crs");
  if (declared === null) return;
  const crs = declared.trim().replace(/^</, "").replace(/>$/, "").trim();
  if (!WGS84_CRS.has(crs)) invalid(`OGC API Features returned coordinates in ${crs}, not WGS 84`);
}

/**
 * A collection that emits geometry must advertise a coordinate reference system
 * this library can read. An attributes-only feed publishes no coordinates, so
 * whatever the collection is stored in does not matter to it.
 */
function assertWgs84Collection(value: JsonObject, config: ValidatedConfig): void {
  if (config.geometry === "skip" || !isJsonArray(value.crs)) return;
  const advertised = value.crs.filter(isJsonString);
  if (advertised.length > 0 && !advertised.some((crs) => WGS84_CRS.has(crs))) {
    invalid("OGC API Features collection advertises no WGS 84 coordinate reference system");
  }
}

function assertUpstream(response: Response, resource: string): void {
  if (!response.ok) {
    throw new GatekeeperError(`OGC API Features ${resource} returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  }
}

function parseDocument(bytes: Uint8Array, label: string): JsonValue {
  try {
    return parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError(`OGC API Features ${label} returned invalid JSON`, "invalid-response");
  }
}

function invalid(message: string): never {
  throw new GatekeeperError(message, "invalid-response");
}
