import {
  GatekeeperError,
  contentEtag,
  fixedOrigin,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJson,
  readBoundedResponse,
  retryAfterSeconds,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "#/index";

/**
 * InfoÁgua, APA's public water app. It has no API: each page is rendered on
 * the server with its data written into the HTML as JavaScript assignments
 * (`DATA_Stations = [...]`), and this library reads those.
 *
 * Only what InfoÁgua alone publishes is read: the flood alert state of each
 * watched station and the drought index of each basin. The readings behind
 * them are SNIRH's and come from the `snirh` library, and the beaches are the
 * ArcGIS `Praias` layer's; InfoÁgua keeps only the last 48 hours of readings.
 */
export const INFOAGUA_ORIGIN = "https://infoagua.apambiente.pt";
/** The flood page is about 300 KB; the ceiling leaves room for a flood with every station in alert. */
export const INFOAGUA_MAX_BYTES = 4 * 1024 * 1024;

export const INFOAGUA_FEEDS = {
  "flood-alerts": {
    kind: "flood-alerts",
    title: "Flood alert state by station",
    description: "The flood alert level InfoÁgua shows for each river, rain and reservoir station it watches.",
    semantics: { domainSubject: "observation", defaultProductRole: "current-state" },
  },
  "drought-index": {
    kind: "drought-index",
    title: "Hydrological drought index by basin",
    description: "The monthly hydrological drought index and state InfoÁgua shows for each river basin.",
    semantics: { domainSubject: "observation", defaultProductRole: "summary" },
  },
} as const satisfies Record<string, FeedKindDescription>;

type InfoaguaFeedName = keyof typeof INFOAGUA_FEEDS;

/** The page each feed reads, and the variable its data is assigned to. */
interface InfoaguaPage {
  path: string;
  variable: string;
}

const PAGES = {
  "flood-alerts": { path: "/pt/cheias/cheias-pesquisa", variable: "DATA_Stations" },
  "drought-index": { path: "/pt/seca", variable: "DATA_AlertsMap" },
} as const satisfies Record<InfoaguaFeedName, InfoaguaPage>;

function isInfoaguaFeed(value: string | undefined): value is InfoaguaFeedName {
  return value !== undefined && Object.hasOwn(INFOAGUA_FEEDS, value);
}

export function validateInfoaguaFeedConfig(config: SourceConfig): SourceConfig {
  for (const key of Object.keys(config))
    if (key !== "feed") throw new GatekeeperError(`Unsupported InfoÁgua field: ${key}`, key === "host" || key === "url" ? "source-denied" : "invalid-config");
  const feed = config.feed?.trim();
  if (!isInfoaguaFeed(feed)) throw new GatekeeperError(`InfoÁgua feeds require feed=${Object.keys(INFOAGUA_FEEDS).join(", ")}`, "invalid-config");
  return { feed };
}

export function infoaguaPageUrl(feed: string | undefined, origin: string): URL {
  if (!isInfoaguaFeed(feed)) throw new GatekeeperError("InfoÁgua feed was not resolved", "invalid-config");
  return new URL(PAGES[feed].path, origin);
}

/** What a collection hands its transform: the page's own array, cut to the fields that are published. */
export interface InfoaguaDocument {
  feed: InfoaguaFeedName;
  entries: JsonObject[];
}

export async function collectInfoaguaFeed(config: SourceConfig, checkpoint: SourceValidator | undefined, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateInfoaguaFeedConfig(config);
  // SAFETY: validateInfoaguaFeedConfig has just confirmed `feed` names an entry of INFOAGUA_FEEDS.
  const feed = validated.feed as InfoaguaFeedName;
  const origin = fixedOrigin(apiOrigin, INFOAGUA_ORIGIN);
  const url = infoaguaPageUrl(feed, origin);
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "text/html" }, redirect: "manual" });
  } catch (error) {
    throw new GatekeeperError(`InfoÁgua request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if (response.status >= 300 && response.status < 400) throw new GatekeeperError("InfoÁgua redirects are not allowed", "source-denied");
  if (!response.ok) throw new GatekeeperError(`InfoÁgua returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  const html = new TextDecoder().decode(await readBoundedResponse(response, INFOAGUA_MAX_BYTES, "InfoÁgua page"));
  const value = assignedJson(html, PAGES[feed].variable);
  if (!isJsonArray(value)) throw new GatekeeperError(`InfoÁgua ${PAGES[feed].variable} is not a list`, "invalid-response");
  const entries = value.map((entry) => (feed === "flood-alerts" ? floodStation(entry) : droughtBasin(entry)));
  const document: InfoaguaDocument = { feed, entries };
  const body = new TextEncoder().encode(JSON.stringify(document));
  // The page changes every hour with its readings; the published fields change far less often, and are what the
  // validator is taken from.
  const validator: SourceValidator = { etag: await contentEtag(body) };
  if (checkpoint?.etag === validator.etag) return { kind: "not-modified", validator };
  return { kind: "body", body, provenance: { sourceUrl: url.toString() }, completeness: "complete", validator };
}

/**
 * The JSON a page assigns to a variable, found by name and read to its
 * matching bracket, so a later script on the page is never parsed as data.
 */
export function assignedJson(html: string, variable: string): JsonValue {
  const assignment = new RegExp(`\\b${variable}\\s*=\\s*`, "u").exec(html);
  if (!assignment) throw new GatekeeperError(`InfoÁgua page has no ${variable}`, "invalid-response");
  const start = assignment.index + assignment[0].length;
  const open = html[start];
  if (open !== "[" && open !== "{") throw new GatekeeperError(`InfoÁgua ${variable} is not a JSON value`, "invalid-response");
  let depth = 0;
  let inString = false;
  for (let index = start; index < html.length; index += 1) {
    const character = html[index];
    if (inString) {
      if (character === "\\") index += 1;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === "[" || character === "{") depth += 1;
    else if (character === "]" || character === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return parseJson(html.slice(start, index + 1));
        } catch {
          throw new GatekeeperError(`InfoÁgua ${variable} is not valid JSON`, "invalid-response");
        }
      }
    }
  }
  throw new GatekeeperError(`InfoÁgua ${variable} never closes`, "invalid-response");
}

/** A watched station, without the reading and its time: those are SNIRH's, and change every hour. */
function floodStation(entry: JsonValue): JsonObject {
  if (!isJsonObject(entry) || !isJsonNumber(entry.snirh_source_id)) throw new GatekeeperError("InfoÁgua listed a station without its SNIRH identifier", "invalid-response");
  const level = isJsonObject(entry.alert_level) ? entry.alert_level : {};
  const type = isJsonObject(entry.station_type) ? entry.station_type : {};
  const parameter = isJsonObject(entry.parameter) ? entry.parameter : {};
  return {
    station: String(entry.snirh_source_id),
    name: text(entry.station_name),
    type: english(type.name),
    river: text(entry.river),
    basin: text(entry.basin_name),
    latitude: coordinate(entry.latitude),
    longitude: coordinate(entry.longitude),
    watchedParameter: text(parameter.name_without_unit),
    alertLevel: isJsonNumber(level.id) ? level.id : null,
    alert: english(level.name),
    alertColor: text(level.color),
  };
}

/** A basin's index for one month; the thresholds between states are left out, as InfoÁgua does not say what they bound. */
function droughtBasin(entry: JsonValue): JsonObject {
  if (!isJsonObject(entry) || !isJsonString(entry.basin_id) || !isJsonNumber(entry.index_year) || !isJsonNumber(entry.index_month))
    throw new GatekeeperError("InfoÁgua listed a drought index without its basin and month", "invalid-response");
  const index = isJsonString(entry.current_volume) ? Number(entry.current_volume) : Number.NaN;
  return {
    basinId: entry.basin_id,
    basin: text(entry.basin_name),
    month: `${entry.index_year}-${String(entry.index_month).padStart(2, "0")}`,
    index: Number.isFinite(index) ? index : null,
    state: isJsonNumber(entry.state) ? entry.state : null,
    stateName: text(entry.state_name),
    stateColor: text(entry.color),
  };
}

function text(value: JsonValue | undefined): string | null {
  return isJsonString(value) && value.trim() !== "" ? value.trim() : null;
}

function english(value: JsonValue | undefined): string | null {
  if (isJsonObject(value)) return text(value.en) ?? text(value.pt);
  return text(value);
}

function coordinate(value: JsonValue | undefined): number | null {
  const number = isJsonNumber(value) ? value : isJsonString(value) ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}
