import {
  GatekeeperError,
  fixedOrigin,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  type CollectionRequest,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
} from "../../index";

export const RIPEATLAS_ORIGIN = "https://atlas.ripe.net";
export const RIPEATLAS_MAX_BYTES = 2 * 1024 * 1024;
export const RIPEATLAS_MAX_PAGE_BYTES = 1024 * 1024;
/** The maximum RIPE Atlas documents; larger pages cost the API the same and save round trips. */
export const RIPEATLAS_PAGE_SIZE = 500;
export const RIPEATLAS_MAX_RECORDS = 1000;
const MAX_REQUESTS = 4;

/**
 * The only probe fields this platform reads. Everything identifying a probe's
 * host is left behind at the request: `address_v4`/`address_v6` (the household's
 * own addresses), `description` (host-written free text, often a name), and
 * `geometry` (a house, which Atlas offsets by only 80-400 m). `last_connected`
 * is left out too: it advances every second a probe is up, so copying it would
 * make all 100-odd Portuguese probes a new revision on every collection.
 */
export const RIPEATLAS_PROBE_FIELDS = "id,country_code,asn_v4,asn_v6,prefix_v4,prefix_v6,is_anchor,is_public,status,status_since,first_connected,tags";

export const RIPEATLAS_FEEDS = {
  "country-probes": {
    kind: "country-probes",
    title: "Country measurement probe inventory",
    description: "Public RIPE Atlas probes registered in one country with their network placement and connection state, not their hosts, addresses or locations.",
    semantics: { domainSubject: "reference", defaultProductRole: "current-state" },
  },
  "country-anchors": {
    kind: "country-anchors",
    title: "Country measurement anchor inventory",
    description: "RIPE Atlas anchors installed in one country, by public hostname and network, not by host organisation, address or coordinates.",
    semantics: { domainSubject: "reference", defaultProductRole: "reference" },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function validateRipeatlasFeedConfig(config: SourceConfig): SourceConfig {
  const feed = config.feed?.trim();
  if (!feed || !Object.hasOwn(RIPEATLAS_FEEDS, feed)) throw new GatekeeperError("RIPE Atlas requires a supported named feed", "invalid-config");
  for (const key of Object.keys(config)) if (key !== "feed" && key !== "country") throw new GatekeeperError(`Unsupported RIPE Atlas field: ${key}`, "invalid-config");
  if (config.country?.trim().toUpperCase() !== "PT") throw new GatekeeperError("RIPE Atlas feeds require country=PT", "invalid-config");
  return { feed, country: "PT" };
}

/** The collection endpoint each feed reads, and the query that keeps it to one country. */
export function endpoint(feed: string | undefined, origin: string = RIPEATLAS_ORIGIN): URL {
  const url = new URL(feed === "country-anchors" ? "/api/v2/anchors/" : "/api/v2/probes/", origin);
  url.searchParams.set("page_size", String(RIPEATLAS_PAGE_SIZE));
  url.searchParams.set("sort", "id");
  if (feed === "country-anchors") {
    // Anchors filter on `country`; `country_code` is silently ignored and returns the world.
    url.searchParams.set("country", "PT");
    return url;
  }
  if (feed !== "country-probes") throw new GatekeeperError("Unsupported RIPE Atlas feed", "invalid-config");
  url.searchParams.set("country_code", "PT");
  // Status 3 (Abandoned) and 4 (Written Off) are retired hardware, not a current fleet.
  url.searchParams.set("status__in", "0,1,2");
  // A host who opted out of being indexed is not republished here, whatever the API still lists.
  url.searchParams.set("is_public", "true");
  url.searchParams.set("fields", RIPEATLAS_PROBE_FIELDS);
  return url;
}

/**
 * RIPE Atlas paginates with `page`/`next` and sends neither ETag nor
 * Last-Modified, so every collection reads every page and the checkpoint keeps
 * no validators. Its rate-limit guidance is to avoid tight polling, use the
 * largest page and cache; the daily and weekly cadences of the examples do that.
 */
export async function collectRipeatlasFeed(
  config: SourceConfig,
  apiOrigin: string,
  fetcher: typeof fetch,
  mode: CollectionRequest["mode"] = { kind: "live" },
): Promise<SourceFetch> {
  const validated = validateRipeatlasFeedConfig(config);
  if (mode.kind === "history") throw new GatekeeperError("RIPE Atlas has no historical walker", "invalid-config");
  const origin = fixedOrigin(apiOrigin, RIPEATLAS_ORIGIN);
  const base = endpoint(validated.feed, origin);
  const encoder = new TextEncoder();
  async function* pages(): AsyncGenerator<Uint8Array> {
    yield encoder.encode('{"pages":[');
    let consumedBytes = 0;
    let separator = "";
    for (let page = 1; page <= MAX_REQUESTS; page += 1) {
      const url = new URL(base);
      url.searchParams.set("page", String(page));
      const response = await request(fetcher, url, origin);
      const bytes = await readBoundedResponse(response, Math.min(RIPEATLAS_MAX_PAGE_BYTES, RIPEATLAS_MAX_BYTES - consumedBytes), "RIPE Atlas page");
      consumedBytes += bytes.byteLength;
      let document: JsonValue;
      try {
        document = parseJsonBytes(bytes);
      } catch {
        throw new GatekeeperError("RIPE Atlas page is not JSON", "invalid-response");
      }
      const envelope = pageEnvelope(document);
      if (envelope.results.length > RIPEATLAS_PAGE_SIZE) throw new GatekeeperError("RIPE Atlas returned more rows than it was asked for", "invalid-response");
      yield encoder.encode(`${separator}${JSON.stringify(document)}`);
      separator = ",";
      if (envelope.next === null) {
        yield encoder.encode("]}");
        return;
      }
    }
    throw new GatekeeperError("RIPE Atlas pagination exceeded four requests", "response-too-large");
  }
  const iterator = pages();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await iterator.next();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) {
        controller.error(error);
      }
    },
    async cancel() {
      await iterator.return(undefined);
    },
  });
  return { kind: "body", body, provenance: { sourceUrl: base.toString() }, completeness: "complete", state: {} };
}

/** One page as the REST API documents it: a total, a continuation link and the rows. */
export interface RipeatlasPage {
  count: number;
  next: string | null;
  results: JsonObject[];
}

/**
 * A continuation must stay on the same collection of the same origin: an
 * attacker-supplied `next` never decides where the next request goes, so this
 * reads it only as "there is more".
 */
export function pageEnvelope(value: JsonValue | undefined): RipeatlasPage {
  if (
    !isJsonObject(value) ||
    !isJsonNumber(value.count) ||
    !Number.isSafeInteger(value.count) ||
    value.count < 0 ||
    !isJsonArray(value.results) ||
    !value.results.every(isJsonObject)
  )
    throw new GatekeeperError("RIPE Atlas returned an invalid page envelope", "invalid-response");
  if (value.error !== undefined) throw new GatekeeperError("RIPE Atlas reported an API error", "invalid-response");
  // `next` is always present, null on the last page. A document without it is not this API's.
  if (value.next === null) return { count: value.count, next: null, results: value.results };
  if (!isJsonString(value.next)) throw new GatekeeperError("RIPE Atlas returned an invalid continuation", "invalid-response");
  let next: URL;
  try {
    next = new URL(value.next);
  } catch {
    throw new GatekeeperError("RIPE Atlas returned an invalid continuation", "invalid-response");
  }
  if (next.origin !== RIPEATLAS_ORIGIN) throw new GatekeeperError("RIPE Atlas continuation left its origin", "source-denied");
  return { count: value.count, next: next.toString(), results: value.results };
}

async function request(fetcher: typeof fetch, url: URL, origin: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(30_000) });
  } catch (error) {
    throw new GatekeeperError(`RIPE Atlas request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if ((response.status >= 300 && response.status < 400) || (response.url && new URL(response.url).origin !== origin))
    throw new GatekeeperError("RIPE Atlas redirects and unsolicited 304s are not allowed", "source-denied");
  if (!response.ok) throw new GatekeeperError(`RIPE Atlas returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  return response;
}
