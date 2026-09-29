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
 * Its own feeds are what InfoÁgua alone publishes: the flood alert state of
 * each watched station, the drought index of each basin, what each reservoir
 * holds and is for, and the hourly flow into and out of each watched
 * reservoir. It also serves the
 * last 48 hours of the readings behind those alerts, which are SNIRH's: SNIRH's
 * river level and precipitation feeds take their live readings from here
 * (`readInfoaguaReadings`), since SNIRH itself answers only from Portugal. The
 * beaches are the ArcGIS `Praias` layer's.
 */
export const INFOAGUA_ORIGIN = "https://infoagua.apambiente.pt";
/** The flood page is about 300 KB; the ceiling leaves room for a flood with every station in alert. */
export const INFOAGUA_MAX_BYTES = 4 * 1024 * 1024;
/** One station's page is about 25 KB; the list and about 90 of them are 2.5 MB. */
const STATION_PAGE_MAX_BYTES = 256 * 1024;
const READINGS_MAX_BYTES = 8 * 1024 * 1024;
const FLOOD_LIST_PATH = "/pt/cheias/cheias-pesquisa";

export const INFOAGUA_FEEDS = {
  // The flood alert level InfoÁgua shows for each river, rain and reservoir station it watches.
  "flood-alerts": {
    kind: "flood-alerts",
    semantics: { domainSubject: "observation", defaultProductRole: "current-state" },
  },
  // The monthly hydrological drought index and state InfoÁgua shows for each river basin.
  "drought-index": {
    kind: "drought-index",
    semantics: { domainSubject: "observation", defaultProductRole: "summary" },
  },
  // What each reservoir on InfoÁgua's drought pages is: its capacity, full supply level, uses and monthly historic lows.
  "reservoirs": {
    kind: "reservoirs",
    semantics: { domainSubject: "reference", defaultProductRole: "reference" },
  },
  // The hourly flow into and out of each reservoir InfoÁgua watches for floods.
  "reservoir-flows": {
    kind: "reservoir-flows",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
  },
} as const satisfies Record<string, FeedKindDescription>;

type InfoaguaFeedName = keyof typeof INFOAGUA_FEEDS;

/** The page each feed reads, and the variable its data is assigned to. */
interface InfoaguaPage {
  path: string;
  variable: string;
}

const PAGES = {
  "flood-alerts": { path: FLOOD_LIST_PATH, variable: "DATA_Stations" },
  "drought-index": { path: "/pt/seca", variable: "DATA_AlertsMap" },
  "reservoirs": { path: "/pt/seca/secas-pesquisa", variable: "DATA_SupStations" },
  // The flows are read from each reservoir's page; this is the list those pages are found from.
  "reservoir-flows": { path: FLOOD_LIST_PATH, variable: "DATA_Stations" },
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

/**
 * What a collection hands its transform: the page's own array, cut to the fields that are published. For the reservoir
 * flows, one entry per reservoir and flow, `{ reading, site, values }`, and how many values could not be read.
 */
export interface InfoaguaDocument {
  feed: InfoaguaFeedName;
  entries: JsonObject[];
  unreadable?: number;
}

export async function collectInfoaguaFeed(config: SourceConfig, checkpoint: SourceValidator | undefined, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateInfoaguaFeedConfig(config);
  // SAFETY: validateInfoaguaFeedConfig has just confirmed `feed` names an entry of INFOAGUA_FEEDS.
  const feed = validated.feed as InfoaguaFeedName;
  const origin = fixedOrigin(apiOrigin, INFOAGUA_ORIGIN);
  const url = infoaguaPageUrl(feed, origin);
  let document: InfoaguaDocument;
  let partial = false;
  if (feed === "reservoir-flows") {
    const read = await readInfoaguaStations(["reservoir-inflow", "reservoir-outflow"], fetcher, origin);
    const entries = read.readings.flatMap(({ reading, stations }) => stations.map((station) => ({ reading, site: station.site, values: station.values })));
    document = { feed, entries, unreadable: read.unreadable };
    partial = read.missing > 0;
  } else {
    const value = assignedJson(await page(url, fetcher, INFOAGUA_MAX_BYTES), PAGES[feed].variable);
    if (!isJsonArray(value)) throw new GatekeeperError(`InfoÁgua ${PAGES[feed].variable} is not a list`, "invalid-response");
    const entry = feed === "flood-alerts" ? floodStation : feed === "drought-index" ? droughtBasin : reservoir;
    document = { feed, entries: value.map(entry) };
  }
  const body = new TextEncoder().encode(JSON.stringify(document));
  // The page changes every hour with its readings; the published fields change far less often, and are what the
  // validator is taken from.
  const validator: SourceValidator = { etag: await contentEtag(body) };
  if (checkpoint?.etag === validator.etag) return { kind: "not-modified", validator };
  return { kind: "body", body, provenance: { sourceUrl: url.toString() }, completeness: partial ? "partial" : "complete", validator };
}

/* ---------- Readings, for SNIRH's live feeds ---------- */

/**
 * What InfoÁgua shows of a watched station's readings, on its own page (`/pt/cheias/cheia-detalhe/<SNIRH site>`,
 * `DATA_StationParameters`). `parameter` is InfoÁgua's identifier and `name` exactly what it calls it, checked on every
 * page, because the name is the only thing tying a list of values to a measurement.
 */
export const INFOAGUA_READINGS = {
  // Hourly, 48 hours back: SNIRH's instantaneous river level, on the same UTC clock.
  "river-level": { stationType: "estacao_hidrometrica", parameter: 4, name: "Nível Hidrométrico (m)" },
  // Every 15 minutes, 24 hours back: the rain of the quarter hour ending at each time.
  "precipitation": { stationType: "estacao_meteorologica", parameter: 5, name: "Precipitação acumulada em 15 min. (mm)" },
  // Hourly, 48 hours back: the flow into a reservoir, and the flow it lets out.
  "reservoir-inflow": { stationType: "estacao_albufeira", parameter: 6, name: "Caudal Afluente (m3/s)" },
  "reservoir-outflow": { stationType: "estacao_albufeira", parameter: 2, name: "Caudal Efluente (m3/s)" },
} as const;

export type InfoaguaReadingName = keyof typeof INFOAGUA_READINGS;

export function isInfoaguaReading(value: string | undefined): value is InfoaguaReadingName {
  return value !== undefined && Object.hasOwn(INFOAGUA_READINGS, value);
}

/** One watched station's values of one measurement, each at a time InfoÁgua writes `YYYY-MM-DD HH:MM:SS` in UTC. */
export interface InfoaguaStationReadings {
  /** The SNIRH site InfoÁgua files the station under (`snirh_source_id`). */
  site: string;
  values: Array<{ moment: string; value: number }>;
}

export interface InfoaguaReadings {
  stations: InfoaguaStationReadings[];
  /** Values that were there but could not be read: a malformed time, or a value that is not a number. */
  unreadable: number;
  /** Listed stations whose page could not be read this time. */
  missing: number;
  /** The page a person can open: the list of watched stations. */
  sourceUrl: string;
}

/** Every station InfoÁgua watches of the kind that measures the reading, with the values its page shows. */
export async function readInfoaguaReadings(reading: InfoaguaReadingName, fetcher: typeof fetch, origin: string = INFOAGUA_ORIGIN): Promise<InfoaguaReadings> {
  const read = await readInfoaguaStations([reading], fetcher, origin);
  return { stations: read.readings[0]?.stations ?? [], unreadable: read.unreadable, missing: read.missing, sourceUrl: read.sourceUrl };
}

/**
 * Several readings of the same kind of station, from one pass over their pages: the station list, then one page per
 * station, which the publisher's client paces. A station page that is gone, moved or failing costs that station only,
 * and is counted as missing; the list, the byte budget and a renamed parameter fail the whole read, and so does a read
 * in which no station page answered.
 */
export async function readInfoaguaStations(
  readings: readonly InfoaguaReadingName[],
  fetcher: typeof fetch,
  origin: string = INFOAGUA_ORIGIN,
): Promise<{ readings: Array<{ reading: InfoaguaReadingName; stations: InfoaguaStationReadings[] }>; unreadable: number; missing: number; sourceUrl: string }> {
  const stationType = INFOAGUA_READINGS[readings[0] ?? "river-level"].stationType;
  if (readings.length === 0 || readings.some((reading) => INFOAGUA_READINGS[reading].stationType !== stationType))
    throw new GatekeeperError("InfoÁgua readings read together must be of one kind of station", "invalid-config");
  const budget = { remaining: READINGS_MAX_BYTES };
  const listUrl = new URL(FLOOD_LIST_PATH, origin);
  const list = assignedJson(await page(listUrl, fetcher, INFOAGUA_MAX_BYTES, budget), "DATA_Stations");
  if (!isJsonArray(list)) throw new GatekeeperError("InfoÁgua DATA_Stations is not a list", "invalid-response");
  const sites = new Set<string>();
  for (const entry of list) {
    if (isJsonObject(entry) && entry.station_type_id === stationType && isJsonNumber(entry.snirh_source_id)) sites.add(String(entry.snirh_source_id));
  }
  if (sites.size === 0) throw new GatekeeperError(`InfoÁgua lists no ${stationType}`, "invalid-response");
  const read = readings.map((reading) => ({ reading, stations: new Array<InfoaguaStationReadings>() }));
  let unreadable = 0;
  const missing: string[] = [];
  for (const site of sites) {
    let parameters: JsonValue;
    try {
      parameters = assignedJson(await page(new URL(`/pt/cheias/cheia-detalhe/${site}`, origin), fetcher, STATION_PAGE_MAX_BYTES, budget), "DATA_StationParameters");
    } catch (error) {
      if (!(error instanceof GatekeeperError) || !["upstream-error", "source-denied", "invalid-response"].includes(error.code)) throw error;
      missing.push(site);
      continue;
    }
    if (!isJsonArray(parameters)) {
      missing.push(site);
      continue;
    }
    for (const target of read) {
      const wanted = INFOAGUA_READINGS[target.reading];
      const parameter = parameters.find((entry) => isJsonObject(entry) && entry.id === wanted.parameter);
      // A station that does not measure it here has nothing to give.
      if (!isJsonObject(parameter)) continue;
      const name = isJsonString(parameter.name) ? parameter.name.trim() : "";
      if (name !== wanted.name) throw new GatekeeperError(`InfoÁgua named parameter ${wanted.parameter} "${name}" where "${wanted.name}" was expected`, "invalid-response");
      const values: InfoaguaStationReadings["values"] = [];
      for (const entry of isJsonArray(parameter.values) ? parameter.values : []) {
        if (!isJsonObject(entry)) {
          unreadable += 1;
          continue;
        }
        // An hour without a reading is written with an empty value.
        if (entry.value === null || entry.value === "") continue;
        if (!isJsonString(entry.moment) || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/u.test(entry.moment) || !isJsonNumber(entry.value)) {
          unreadable += 1;
          continue;
        }
        values.push({ moment: entry.moment, value: entry.value });
      }
      target.stations.push({ site, values });
    }
  }
  if (missing.length === sites.size) throw new GatekeeperError(`InfoÁgua answered none of its ${sites.size} ${stationType} pages`, "upstream-error");
  if (missing.length > 0)
    console.warn(JSON.stringify({ event: "infoagua_station_pages_missing", stationType, missing: missing.length, of: sites.size, sites: missing.slice(0, 10) }));
  return { readings: read, unreadable, missing: missing.length, sourceUrl: listUrl.toString() };
}

/** One page, whole: InfoÁgua answers every page from its own origin, and a redirect means the page is not there. */
async function page(url: URL, fetcher: typeof fetch, maxBytes: number, budget: { remaining: number } = { remaining: maxBytes }): Promise<string> {
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "text/html" }, redirect: "manual" });
  } catch (error) {
    throw new GatekeeperError(`InfoÁgua request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if (response.status >= 300 && response.status < 400) throw new GatekeeperError("InfoÁgua redirects are not allowed", "source-denied");
  if (!response.ok) throw new GatekeeperError(`InfoÁgua returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  if (budget.remaining <= 0) throw new GatekeeperError("InfoÁgua pages exceed this collection's byte budget", "response-too-large");
  const bytes = await readBoundedResponse(response, Math.min(maxBytes, budget.remaining), "InfoÁgua page");
  budget.remaining -= bytes.byteLength;
  return new TextDecoder().decode(bytes);
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

/**
 * A reservoir of the drought pages: its SNIRH code (`snirh_station_symbol`), what it holds and is for, and for each
 * calendar month the lowest volume on record, with its year. The latest volume is left out: SNIRH's reservoir feeds
 * carry it. Volumes are in cubic hectometres, levels in metres above sea level.
 */
function reservoir(entry: JsonValue): JsonObject {
  if (!isJsonObject(entry) || !isJsonString(entry.snirh_station_symbol) || !isJsonString(entry.snirh_code))
    throw new GatekeeperError("InfoÁgua listed a reservoir without its SNIRH code", "invalid-response");
  const lows: JsonObject[] = [];
  for (let month = 1; month <= 12; month += 1) {
    const volume = number(entry[`min_value${month}`]);
    const year = number(entry[`min_year${month}`]);
    if (volume !== null && year !== null) lows.push({ month, volumeHm3: volume, year });
  }
  return {
    station: entry.snirh_station_symbol,
    site: entry.snirh_code,
    name: text(entry.name),
    basin: text(entry.basin_name),
    latitude: coordinate(entry.latitude),
    longitude: coordinate(entry.longitude),
    capacityHm3: number(entry.max_volume),
    usableVolumeHm3: number(entry.usable_volume),
    fullSupplyLevelM: number(entry.npa),
    waterSupply: flag(entry.abastecimento),
    energy: flag(entry.energia),
    industry: flag(entry.industria),
    irrigation: flag(entry.rega_agricola),
    environmentalFlow: flag(entry.caudal_ecologico),
    floodControl: flag(entry.flood_control),
    monthlyLows: lows,
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

/** A number InfoÁgua writes as a number or as its digits. */
function number(value: JsonValue | undefined): number | null {
  const parsed = isJsonNumber(value) ? value : isJsonString(value) && value.trim() !== "" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** InfoÁgua's `"1"` or `1` for yes, `"0"` or `0` for no. */
function flag(value: JsonValue | undefined): boolean | null {
  const parsed = number(value);
  return parsed === null ? null : parsed === 1;
}

function coordinate(value: JsonValue | undefined): number | null {
  const number = isJsonNumber(value) ? value : isJsonString(value) ? Number(value) : Number.NaN;
  return Number.isFinite(number) ? number : null;
}
