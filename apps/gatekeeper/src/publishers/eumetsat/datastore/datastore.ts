import {
  GatekeeperError,
  fixedOrigin,
  isJsonArray,
  isJsonObject,
  isJsonString,
  readBoundedJson,
  readBoundedResponse,
  retryAfterSeconds,
  type FeedKindDescription,
  type JsonObject,
  type SourceBody,
  type SourceConfig,
  type SourceFetch,
} from "#/index";
import { readCapFires } from "./cap";

/**
 * EUMETSAT's Data Store API: an OpenSearch catalogue of every product
 * EUMETSAT disseminates, open to anyone, and the products' files, which take
 * an OAuth 2 token from a registered user's consumer key and secret.
 */
export const DATASTORE_API_ORIGIN = "https://api.eumetsat.int";

/** Meteosat Third Generation's Active Fire Monitoring, as Common Alerting Protocol messages: one per 10-minute scan of the whole disk. */
export const ACTIVE_FIRES_COLLECTION = "EO:EUM:DAT:0801";

/** What a person opens to read about the collection; the API's own answers are JSON and files. */
export const ACTIVE_FIRES_PAGE = "https://data.eumetsat.int/product/EO:EUM:DAT:0801";

export const DATASTORE_FEEDS = {
  // Fire pixels from Meteosat Third Generation's 10-minute scans, kept where they fall on Portugal.
  "active-fires": {
    kind: "active-fires",
    semantics: { domainSubject: "event", defaultProductRole: "event-log" },
  },
} as const satisfies Record<string, FeedKindDescription>;

/** The consumer key and secret of the EUMETSAT account the Data Store's files are read with. */
export interface DataStoreCredentials {
  key: string | undefined;
  secret: string | undefined;
}

const SCAN_MS = 10 * 60_000;
/** The most scans one collection reads: an hour of them, so a feed that fell behind catches up at six times the pace. */
const MAX_SCANS = 6;
/** A feed with no cursor, or one more than a day behind, starts at the last hour: the live read never walks the archive. */
const MAX_BEHIND_MS = 24 * 3_600_000;
/** A whole-disk scan in the African dry season lists a few thousand fires, some hundreds of kilobytes. */
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SEARCH_BYTES = 1024 * 1024;
const MAX_TOKEN_BYTES = 64 * 1024;
/** Data Store product names: the WMO file name, letters, digits and `_,+-`. */
const PRODUCT_ID = /^[A-Za-z0-9_,+-]{1,255}$/u;

export const ACTIVE_FIRES_MAX_BYTES = 8 * 1024 * 1024;

export function validateDataStoreFeedConfig(config: SourceConfig): SourceConfig {
  if (config.feed !== "active-fires") throw new GatekeeperError("Data Store feeds require feed=active-fires", "invalid-config");
  const unsupported = Object.keys(config).filter((key) => key !== "feed");
  if (unsupported.length > 0) throw new GatekeeperError(`Data Store feed configuration does not accept ${unsupported.join(", ")}`, "source-denied");
  return { feed: "active-fires" };
}

/**
 * Reads the scans after the feed's cursor that the Data Store lists, up to an
 * hour of them, and hands the transform every fire each one states. A token,
 * one search and one small file per new scan; nothing past the search when no
 * scan is new.
 */
export async function collectActiveFires(
  state: JsonObject | undefined,
  now: Date,
  apiOrigin: string,
  credentials: DataStoreCredentials,
  fetcher: typeof fetch,
): Promise<SourceFetch> {
  const origin = fixedOrigin(apiOrigin, DATASTORE_API_ORIGIN);
  const token = await accessToken(origin, credentials, fetcher);
  const cursor = isJsonString(state?.after) ? Date.parse(state.after) : Number.NaN;
  const after = Number.isFinite(cursor) && cursor >= now.getTime() - MAX_BEHIND_MS ? cursor : Math.floor(now.getTime() / SCAN_MS) * SCAN_MS - MAX_SCANS * SCAN_MS;

  const products = (await searchProducts(origin, ACTIVE_FIRES_COLLECTION, after, token, fetcher)).filter((product) => product.start >= after);
  if (products.length === 0) return { kind: "not-modified" };

  const scans: JsonObject[] = [];
  let rejected = 0;
  for (const product of products) {
    const xml = await readEntry(origin, ACTIVE_FIRES_COLLECTION, product.id, `${product.id}.xml`, token, fetcher);
    const read = readCapFires(new TextDecoder().decode(xml));
    rejected += read.rejected;
    scans.push({ start: new Date(product.start).toISOString(), fires: read.fires });
  }
  const last = products.at(-1)!;
  const body = new TextEncoder().encode(JSON.stringify({ scans, rejected }));
  if (body.byteLength > ACTIVE_FIRES_MAX_BYTES) throw new GatekeeperError(`Active fire scans exceeded ${ACTIVE_FIRES_MAX_BYTES} bytes`, "response-too-large");
  const fetched: SourceBody = {
    kind: "body",
    body,
    provenance: { sourceUrl: ACTIVE_FIRES_PAGE, sourcePublishedAt: new Date(last.published).toISOString() },
    // Every scan read is read whole.
    completeness: "complete",
    state: { after: new Date(last.end).toISOString() },
  };
  return fetched;
}

/** One product the search lists: its name, the scan it covers, and when the Data Store published it. */
interface ListedProduct {
  id: string;
  start: number;
  end: number;
  published: number;
}

/** The collection's products whose scans end after `after`, oldest first, up to an hour of them. */
async function searchProducts(origin: string, collection: string, after: number, token: string, fetcher: typeof fetch): Promise<ListedProduct[]> {
  const url = new URL("/data/search-products/1.0.0/os", origin);
  url.searchParams.set("pi", collection);
  url.searchParams.set("format", "json");
  url.searchParams.set("dtstart", new Date(after).toISOString());
  url.searchParams.set("sort", "start,time,1");
  url.searchParams.set("c", String(MAX_SCANS));
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, redirect: "manual" });
  if (!response.ok) throw await upstreamError(`EUMETSAT's Data Store search returned HTTP ${response.status}`, response);
  const answer = await readBoundedJson(response, MAX_SEARCH_BYTES, "EUMETSAT Data Store search");
  if (!isJsonObject(answer) || !isJsonArray(answer.features)) throw new GatekeeperError("EUMETSAT's Data Store search answer has no products", "invalid-response");
  const products = answer.features.map((feature): ListedProduct => {
    const properties = isJsonObject(feature) ? feature.properties : undefined;
    if (!isJsonObject(properties) || !isJsonString(properties.identifier) || !PRODUCT_ID.test(properties.identifier))
      throw new GatekeeperError("EUMETSAT's Data Store listed a product without a usable name", "invalid-response");
    const [start, end] = isJsonString(properties.date) ? properties.date.split("/").map((instant) => Date.parse(instant)) : [];
    const published = isJsonString(properties.updated) ? Date.parse(properties.updated) : Number.NaN;
    if (start === undefined || end === undefined || !Number.isFinite(start) || !Number.isFinite(end) || end <= start || !Number.isFinite(published))
      throw new GatekeeperError(`EUMETSAT's Data Store listed ${properties.identifier} without its scan's times`, "invalid-response");
    return { id: properties.identifier, start, end, published };
  });
  for (let index = 1; index < products.length; index += 1)
    if (products[index]!.start <= products[index - 1]!.start) throw new GatekeeperError("EUMETSAT's Data Store search is not in scan order", "invalid-response");
  return products;
}

/** One file of a product, by the name its manifest gives it. */
async function readEntry(origin: string, collection: string, product: string, name: string, token: string, fetcher: typeof fetch): Promise<Uint8Array> {
  const url = new URL(`/data/download/1.0.0/collections/${encodeURIComponent(collection)}/products/${encodeURIComponent(product)}/entry`, origin);
  url.searchParams.set("name", name);
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${token}` }, redirect: "manual" });
  if (!response.ok) throw await upstreamError(`EUMETSAT's Data Store returned HTTP ${response.status} for ${name}`, response);
  return readBoundedResponse(response, MAX_FILE_BYTES, `EUMETSAT ${name}`);
}

/** One OAuth 2 client-credentials token per collection; nothing is kept between collections. */
async function accessToken(origin: string, credentials: DataStoreCredentials, fetcher: typeof fetch): Promise<string> {
  const { key, secret } = credentials;
  if (!key || !secret) throw new GatekeeperError("EUMETSAT credentials are not configured (EUMETSAT_CONSUMER_KEY and EUMETSAT_CONSUMER_SECRET)", "invalid-config");
  const response = await fetcher(new URL("/token", origin), {
    method: "POST",
    redirect: "manual",
    headers: { Authorization: `Basic ${btoa(`${key}:${secret}`)}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: "grant_type=client_credentials",
  });
  // Rejected credentials stay rejected until someone changes them: that is configuration, not a passing failure.
  if (response.status === 400 || response.status === 401) {
    await response.body?.cancel().catch(() => undefined);
    throw new GatekeeperError(`EUMETSAT rejected the API credentials (HTTP ${response.status})`, "invalid-config");
  }
  if (!response.ok) throw await upstreamError(`EUMETSAT's token endpoint returned HTTP ${response.status}`, response);
  const value = await readBoundedJson(response, MAX_TOKEN_BYTES, "EUMETSAT token answer");
  const token = isJsonObject(value) && isJsonString(value.access_token) && value.access_token !== "" ? value.access_token : undefined;
  if (token === undefined) throw new GatekeeperError("EUMETSAT's token endpoint returned no access token", "invalid-response");
  return token;
}

async function upstreamError(message: string, response: Response): Promise<GatekeeperError> {
  await response.body?.cancel().catch(() => undefined);
  return new GatekeeperError(message, "upstream-error", retryAfterSeconds(response.headers));
}
