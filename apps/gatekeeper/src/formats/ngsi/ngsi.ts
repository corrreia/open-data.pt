import {
  GatekeeperError,
  allowedHosts,
  contentEtag,
  isJsonObject,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  type FeedKindDescription,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "#/index";

/**
 * NGSI v2 is the context API a FIWARE broker answers on: one collection,
 * `/v2/entities`, holding typed entities that hold attributes. Cities run
 * brokers as the live face of their sensors and fleets, which is why this is a
 * format and not one city's library — Porto's broker is the first read, and
 * the next one is an entry in the host list and an example.
 */
export const NGSI_PATH = "/v2/entities";
export const NGSI_MAX_BYTES = 8 * 1024 * 1024;
/** One page of entities; the broker refuses more and answers a total count in a header. */
const NGSI_PAGE_SIZE = 1000;
const NGSI_MAX_ENTITIES = 20_000;
const NGSI_TOTAL_HEADER = "fiware-total-count";

export const NGSI_FEEDS = {
  observations: {
    kind: "observations",
    title: "NGSI observations",
    description: "Entities of one type from an NGSI v2 broker, each carrying the time it was observed: the latest reading of each, and the measurements as series.",
    semantics: { domainSubject: "observation", defaultProductRole: "current-state" },
  },
  inventory: {
    kind: "inventory",
    title: "NGSI inventory",
    description: "Entities of one type from an NGSI v2 broker as they stand now: what each is and the state it is in, with no clock of its own.",
    semantics: { domainSubject: "feature", defaultProductRole: "current-state" },
  },
} as const satisfies Record<string, FeedKindDescription>;

/** An NGSI attribute name: what the broker's own data models use. */
const ATTRIBUTE = /^[A-Za-z_][A-Za-z0-9_]*$/u;
/**
 * An NGSI `q` filter, as the broker's Simple Query Language writes it
 * (`vehicleType==bus`). Restricted to the characters that language needs, so a
 * feed cannot smuggle another parameter into the query string through it.
 */
const QUERY = /^[A-Za-z0-9_.:;=!<>~'"^|+\- ]{1,200}$/u;

export function validateNgsiFeedConfig(config: SourceConfig, hosts: ReadonlySet<string>): SourceConfig {
  const feed = config.feed?.trim();
  if (feed !== "observations" && feed !== "inventory") throw new GatekeeperError("NGSI requires feed=observations or feed=inventory", "invalid-config");
  const allowed = feed === "observations" ? ["feed", "host", "entityType", "query", "timeField", "measures"] : ["feed", "host", "entityType", "query", "timeField"];
  for (const key of Object.keys(config)) {
    if (!allowed.includes(key)) throw new GatekeeperError(`Unsupported NGSI field: ${key}`, key === "url" ? "source-denied" : "invalid-config");
  }
  const host = config.host?.trim().toLowerCase();
  if (!host || !hosts.has(host)) throw new GatekeeperError("The NGSI host is not allowed", "source-denied");
  const normalized: SourceConfig = { feed, host, entityType: token(config.entityType, "entityType", /^[A-Za-z][A-Za-z0-9_]{0,80}$/u) };
  if (config.query !== undefined) normalized.query = token(config.query, "query", QUERY);
  if (feed === "observations") {
    // An observation is dated by the clock the entity carries; without one it is not an observation.
    normalized.timeField = token(config.timeField, "timeField", ATTRIBUTE);
    normalized.measures = measureList(config.measures);
  } else if (config.timeField !== undefined) {
    // An inventory need not be dated — a parking bay's free spaces are true when asked — but
    // where the entity does carry a clock, that clock is the one the rows are dated by.
    normalized.timeField = token(config.timeField, "timeField", ATTRIBUTE);
  }
  return normalized;
}

export function ngsiHosts(value: string): ReadonlySet<string> {
  const hosts = allowedHosts(value);
  if (hosts.size === 0) throw new GatekeeperError("No publisher's feed names a NGSI host to read", "source-denied");
  return hosts;
}

/**
 * Every entity of the configured type, page by page. The broker answers a page
 * and the total it was drawn from, so a page that comes back short of the total
 * is a truncated read rather than the end of the collection.
 *
 * Entities are asked for as `keyValues`, which is the same information without
 * the per-attribute `{type, value, metadata}` wrapper. Porto's broker leaves
 * that metadata empty on every attribute, so the wrapper carries nothing the
 * normalizer would keep, and the flat form is a third of the bytes.
 */
export async function collectNgsiFeed(config: SourceConfig, checkpoint: SourceValidator | undefined, hosts: ReadonlySet<string>, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateNgsiFeedConfig(config, hosts);
  const entities: JsonValue[] = [];
  const encoder = new TextEncoder();
  let aggregateBytes = 64;
  let total: number | undefined;
  for (let offset = 0; offset < NGSI_MAX_ENTITIES; offset += NGSI_PAGE_SIZE) {
    const url = entitiesUrl(validated, offset);
    const response = await request(fetcher, url);
    if (total === undefined) {
      total = countHeader(response.headers.get(NGSI_TOTAL_HEADER));
      if (total > NGSI_MAX_ENTITIES)
        throw new GatekeeperError(`NGSI type ${validated.entityType ?? ""} holds ${total} entities, more than this library reads`, "response-too-large");
    }
    const page = parseJsonBytes(await readBoundedResponse(response, NGSI_MAX_BYTES, "NGSI entities"));
    if (!Array.isArray(page)) throw new GatekeeperError("NGSI returned something other than a list of entities", "invalid-response");
    // Bounding each page bounds nothing: twenty pages of eight megabytes is a hundred and
    // sixty, and the parsed objects outweigh the bytes they came from. The bound is on what
    // has been gathered so far, so a broker cannot grow a collection past it one page at a time.
    for (const entity of page) {
      aggregateBytes += encoder.encode(JSON.stringify(entity)).byteLength + 1;
      if (aggregateBytes > NGSI_MAX_BYTES) throw new GatekeeperError("NGSI collection exceeded its byte bound", "response-too-large");
      entities.push(entity);
    }
    if (page.length < NGSI_PAGE_SIZE) break;
  }
  if (total !== undefined && entities.length !== total) {
    throw new GatekeeperError(`NGSI answered ${entities.length} of the ${total} entities it counted`, "upstream-error");
  }
  const body = encoder.encode(JSON.stringify({ entityType: validated.entityType, entities }));
  const etag = await contentEtag(body);
  if (checkpoint?.etag === etag) return { kind: "not-modified", validator: { etag } };
  return {
    kind: "body",
    body,
    // The link a reader can open is the query itself: the broker answers it without a key.
    provenance: { sourceUrl: entitiesUrl(validated, 0).toString() },
    completeness: "complete",
    validator: { etag },
  };
}

function entitiesUrl(config: SourceConfig, offset: number): URL {
  const url = new URL(NGSI_PATH, `https://${config.host ?? ""}`);
  url.searchParams.set("type", config.entityType ?? "");
  if (config.query) url.searchParams.set("q", config.query);
  url.searchParams.set("options", "keyValues,count");
  url.searchParams.set("limit", String(NGSI_PAGE_SIZE));
  if (offset > 0) url.searchParams.set("offset", String(offset));
  return url;
}

async function request(fetcher: typeof fetch, url: URL): Promise<Response> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "application/json" }, redirect: "manual" });
  } catch (error) {
    throw new GatekeeperError(`NGSI request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if (!response.ok) throw new GatekeeperError(`NGSI answered ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  return response;
}

/** The broker states how many entities the query matched; without it a short page cannot be told from the end. */
function countHeader(value: string | null): number {
  const count = value === null ? Number.NaN : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) throw new GatekeeperError("NGSI omitted its total count", "invalid-response");
  return count;
}

/**
 * The measurements to publish as series, named one by one and never inferred:
 * an entity's numeric-looking attributes include counts of trips and bearings
 * in degrees, and a series invented from those is a chart of nothing.
 *
 * A measure may name its unit — `LAeq=dB(A)` — but only where the measurement's
 * own name fixes it. This broker states no units anywhere: every attribute
 * carries empty metadata, so an unnamed measure is served without a unit
 * rather than with a guessed one.
 */
function measureList(value: string | undefined): string {
  const measures = (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  if (measures.length === 0 || measures.length > 40) throw new GatekeeperError("NGSI observations name one to forty measures", "invalid-config");
  for (const measure of measures) {
    const [name, unit] = measure.split("=");
    if (name === undefined || !ATTRIBUTE.test(name)) throw new GatekeeperError(`NGSI measure "${measure}" is not an attribute name`, "invalid-config");
    if (unit !== undefined && (unit === "" || unit.length > 20)) throw new GatekeeperError(`NGSI measure "${measure}" names an empty unit`, "invalid-config");
  }
  return measures.join(",");
}

/** A measure's attribute name and the unit the example states for it, if any. */
export function ngsiMeasures(value: string | undefined): readonly { readonly name: string; readonly unit: string }[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map((entry) => {
      const [name, unit] = entry.split("=");
      return { name: name ?? "", unit: unit ?? "" };
    });
}

function token(value: string | undefined, name: string, pattern: RegExp): string {
  const text = value?.trim();
  if (!text || text.length > 200 || !pattern.test(text)) throw new GatekeeperError(`NGSI ${name} is invalid`, "invalid-config");
  return text;
}

/** Re-exported for the transformer, which reads the same flat entities this fetched. */
export function isNgsiDocument(value: JsonValue | undefined): value is { entityType: string; entities: JsonValue[] } {
  return isJsonObject(value) && Array.isArray(value.entities);
}
