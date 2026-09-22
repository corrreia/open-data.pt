import {
  GatekeeperError,
  contentEtag,
  fixedOrigin,
  readBoundedResponse,
  retryAfterSeconds,
  type FeedKindDescription,
  type HistoryCursor,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "../../../index";

/**
 * SNIRH, APA's national water resources information system. It has no API:
 * what this library reads is what its own pages read — the station database's
 * CSV export, and the XML and HTML its monthly bulletins are drawn from. Every
 * page answers anonymously; the site's footer permits reuse with the source named.
 */
export const SNIRH_ORIGIN = "https://snirh.apambiente.pt";
/** Everything one collection downloads, summed across its requests. */
export const SNIRH_MAX_BYTES = 12 * 1024 * 1024;
/**
 * The database's own form refuses more than 50 station-parameter pairs per
 * query, and the server gives up at 60 seconds: 500 stations at once timed out.
 */
export const SNIRH_BATCH_STATIONS = 50;
/** The page a person can open to query the station database. */
export const SNIRH_DATABASE_PAGE = `${SNIRH_ORIGIN}/index.php?idMain=2&idItem=1`;

const DAY_MS = 86_400_000;

/**
 * One parameter of the station database. `label` and `unit` are exactly what
 * the CSV export prints above its column, and are checked against it, because
 * that header is the only thing tying a column to a parameter.
 */
export interface SnirhReading {
  /** The database's network ("rede") identifier. */
  network: string;
  /** The database's parameter identifier. */
  parameter: string;
  label: string;
  unit: string;
  title: string;
  description: string;
  /** Days a live collection asks for: enough to take in a late day or a correction. */
  liveDays: number;
  /** Days one history slice covers, sized so the busiest decade of the network stays under the output limits. */
  historyDays: number;
}

const HYDROMETRIC = "920123705";
const METEOROLOGICAL = "920123704";
const PIEZOMETRIC = "100290946";

export const SNIRH_READINGS = {
  "river-level": {
    network: HYDROMETRIC,
    parameter: "1843",
    label: "Nível hidrométrico Instantâneo",
    unit: "m",
    title: "River levels",
    description:
      "Instantaneous water level at SNIRH hydrometric stations, in metres above each station's gauge zero: hourly, and every 5 to 15 minutes at some stations or in a flood.",
    liveDays: 3,
    // Up to 96 readings a day at the busiest stations.
    historyDays: 2,
  },
  "river-flow": {
    network: HYDROMETRIC,
    parameter: "1850",
    label: "Caudal médio diário",
    unit: "m3/s",
    title: "River flows",
    description: "Mean daily flow at SNIRH hydrometric stations.",
    liveDays: 7,
    historyDays: 183,
  },
  "reservoir-volume": {
    network: HYDROMETRIC,
    parameter: "354895398",
    label: "Volume armazenado na última hora",
    unit: "dam3",
    title: "Reservoir storage",
    description: "Water stored in each reservoir SNIRH monitors, read once a day at 23:00 UTC, in cubic decametres (thousands of cubic metres).",
    liveDays: 7,
    historyDays: 183,
  },
  "reservoir-level": {
    network: HYDROMETRIC,
    parameter: "354895424",
    label: "Cota da albufeira na última hora",
    unit: "m",
    title: "Reservoir water levels",
    description: "Water surface elevation of each reservoir SNIRH monitors, read once a day at 23:00 UTC, in metres above sea level.",
    liveDays: 7,
    historyDays: 183,
  },
  "precipitation": {
    network: METEOROLOGICAL,
    parameter: "100744007",
    label: "Precipitação horária",
    unit: "mm",
    title: "Hourly precipitation",
    description: "Hourly precipitation at SNIRH meteorological stations.",
    liveDays: 3,
    historyDays: 4,
  },
  "air-temperature": {
    network: METEOROLOGICAL,
    parameter: "100745177",
    label: "Temperatura do ar horária",
    unit: "°C",
    title: "Hourly air temperature",
    description: "Hourly air temperature at SNIRH meteorological stations.",
    liveDays: 3,
    historyDays: 4,
  },
  "relative-humidity": {
    network: METEOROLOGICAL,
    parameter: "100750599",
    label: "Humidade relativa horária",
    unit: "%",
    title: "Hourly relative humidity",
    description: "Hourly relative humidity at SNIRH meteorological stations.",
    liveDays: 3,
    historyDays: 4,
  },
  "wind-speed": {
    network: METEOROLOGICAL,
    parameter: "100750606",
    label: "Velocidade do vento horária",
    unit: "m/s",
    title: "Hourly wind speed",
    description: "Hourly wind speed at SNIRH meteorological stations.",
    liveDays: 3,
    historyDays: 4,
  },
  "groundwater-level": {
    network: PIEZOMETRIC,
    parameter: "100290981",
    label: "Nível piezométrico",
    unit: "m",
    title: "Groundwater levels",
    description:
      "Piezometric level at SNIRH groundwater observation wells, in metres above sea level. Most wells are read by hand about once a month, so readings arrive weeks after they are taken.",
    liveDays: 120,
    historyDays: 732,
  },
} as const satisfies Record<string, SnirhReading>;

export type SnirhReadingName = keyof typeof SNIRH_READINGS;

export function isSnirhReading(value: string | undefined): value is SnirhReadingName {
  return value !== undefined && Object.hasOwn(SNIRH_READINGS, value);
}

/** The first hydrological year each bulletin's archive answers for, as the October it starts. */
const PRECIPITATION_FIRST_MONTH = "1980-10";
const RESERVOIR_FIRST_HYDROLOGICAL_YEAR = 1989;
const GROUNDWATER_FIRST_MONTH = "2000-10";

export const SNIRH_FEEDS = {
  readings: {
    kind: "readings",
    title: "Station readings",
    description: "One parameter of SNIRH's station database, for every station that measures it.",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
    history: {},
  },
  "monthly-precipitation": {
    kind: "monthly-precipitation",
    title: "Monthly precipitation bulletin",
    description: "Monthly precipitation at the stations of SNIRH's precipitation bulletin, with each station's monthly normal.",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
    history: { earliest: `${PRECIPITATION_FIRST_MONTH}-01T00:00:00.000Z` },
  },
  "reservoir-basins": {
    kind: "reservoir-basins",
    title: "Reservoir storage by river basin",
    description: "End-of-month water stored in the bulletin's reservoirs of each river basin, as a share of their total capacity.",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
    history: { earliest: `${RESERVOIR_FIRST_HYDROLOGICAL_YEAR}-10-01T00:00:00.000Z` },
  },
  "groundwater-state": {
    kind: "groundwater-state",
    title: "Groundwater state by aquifer",
    description: "Each month's groundwater level class of every aquifer in SNIRH's groundwater bulletin.",
    semantics: { domainSubject: "observation", defaultProductRole: "summary" },
    history: { earliest: `${GROUNDWATER_FIRST_MONTH}-01T00:00:00.000Z` },
  },
} as const satisfies Record<string, FeedKindDescription>;

type SnirhFeedName = keyof typeof SNIRH_FEEDS;

function isSnirhFeed(value: string | undefined): value is SnirhFeedName {
  return value !== undefined && Object.hasOwn(SNIRH_FEEDS, value);
}

export function validateSnirhFeedConfig(config: SourceConfig): SourceConfig {
  for (const key of Object.keys(config))
    if (key !== "feed" && key !== "reading") throw new GatekeeperError(`Unsupported SNIRH field: ${key}`, key === "host" || key === "url" ? "source-denied" : "invalid-config");
  const feed = config.feed?.trim();
  if (!isSnirhFeed(feed)) throw new GatekeeperError(`SNIRH feeds require feed=${Object.keys(SNIRH_FEEDS).join(", ")}`, "invalid-config");
  if (feed !== "readings") {
    if (config.reading !== undefined) throw new GatekeeperError("Only SNIRH readings name a reading", "invalid-config");
    return { feed };
  }
  const reading = config.reading?.trim();
  if (!isSnirhReading(reading)) throw new GatekeeperError(`SNIRH readings require reading=${Object.keys(SNIRH_READINGS).join(", ")}`, "invalid-config");
  return { feed, reading };
}

/* ---------- The documents a collection hands its transform ---------- */

/** One station of the database, as its station list names it. */
export interface SnirhStation {
  /** The database's own numeric site identifier, which the CSV export is asked by. */
  site: string;
  /** The station code printed everywhere else, such as `17G/02H`. */
  code: string;
  name: string;
}

/** One CSV export, and the sites it was asked for in the order its columns follow. */
export interface SnirhReadingsTable {
  sites: string[];
  csv: string;
}

export type SnirhDocument =
  | { kind: "readings"; reading: SnirhReadingName; stations: SnirhStation[]; tables: SnirhReadingsTable[]; before?: string }
  | { kind: "monthly-precipitation"; months: Array<{ month: string; xml: string }>; before?: string }
  | { kind: "reservoir-basins"; years: Array<{ hydrologicalYear: number; html: string }>; before?: string }
  | { kind: "groundwater-state"; months: Array<{ month: string; xml: string }>; before?: string };

/** One collection's document, with where the history walk goes next and the page a person can open. */
interface SnirhSlice {
  document: SnirhDocument;
  next?: HistoryCursor;
  sourceUrl: string;
}

/** What one collection is asked for: the present, or the slice of history before a cursor. */
type Mode = { kind: "live"; now: Date } | { kind: "history"; cursor: HistoryCursor };

interface Session {
  origin: string;
  fetcher: typeof fetch;
  /** Bytes still allowed across every request of this collection. */
  remaining: number;
}

export async function collectSnirhFeed(
  config: SourceConfig,
  checkpoint: SourceValidator | undefined,
  apiOrigin: string,
  fetcher: typeof fetch,
  now: Date = new Date(),
): Promise<SourceFetch> {
  return collect(config, { kind: "live", now }, checkpoint, apiOrigin, fetcher);
}

export async function collectSnirhHistory(config: SourceConfig, cursor: HistoryCursor, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  return collect(config, { kind: "history", cursor }, undefined, apiOrigin, fetcher);
}

async function collect(config: SourceConfig, mode: Mode, checkpoint: SourceValidator | undefined, apiOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const validated = validateSnirhFeedConfig(config);
  const session: Session = { origin: fixedOrigin(apiOrigin, SNIRH_ORIGIN), fetcher, remaining: SNIRH_MAX_BYTES };
  let slice: SnirhSlice | "exhausted";
  switch (validated.feed) {
    case "readings": {
      // SAFETY: validateSnirhFeedConfig has just confirmed `reading` names an entry of SNIRH_READINGS.
      slice = await readingsSlice(validated.reading as SnirhReadingName, mode, session);
      break;
    }
    case "monthly-precipitation":
      slice = await precipitationSlice(mode, session);
      break;
    case "reservoir-basins":
      slice = await reservoirSlice(mode, session);
      break;
    default:
      slice = await groundwaterSlice(mode, session);
  }
  if (slice === "exhausted") return { kind: "exhausted" };
  const body = new TextEncoder().encode(JSON.stringify(slice.document));
  if (mode.kind === "history") {
    const fetched: SourceFetch = { kind: "body", body, provenance: { sourceUrl: slice.sourceUrl }, completeness: "complete" };
    if (slice.next) fetched.next = slice.next;
    else fetched.exhausted = true;
    return fetched;
  }
  const validator: SourceValidator = { etag: await contentEtag(body) };
  if (checkpoint?.etag === validator.etag) return { kind: "not-modified", validator };
  return { kind: "body", body, provenance: { sourceUrl: slice.sourceUrl }, completeness: "complete", validator };
}

/* ---------- Station readings ---------- */

async function readingsSlice(reading: SnirhReadingName, mode: Mode, session: Session): Promise<SnirhSlice> {
  const definition = SNIRH_READINGS[reading];
  let first: string;
  let last: string;
  let next: HistoryCursor | undefined;
  let before: string | undefined;
  if (mode.kind === "live") {
    last = utcDay(mode.now);
    first = addDays(last, -(definition.liveDays - 1));
  } else {
    before = historyBefore(mode.cursor).toISOString();
    last = utcDay(new Date(Date.parse(before) - 1));
    first = addDays(last, -(definition.historyDays - 1));
    next = { before: `${first}T00:00:00.000Z` };
  }
  // A live collection asks only for stations still in service; a history slice asks for every station that ever
  // measured the parameter, since one closed since then may have been reporting in the years it walks.
  const stations = await stationList(definition, mode.kind === "live" ? "ATIVA" : "", session);
  const tables: SnirhReadingsTable[] = [];
  for (let index = 0; index < stations.length; index += SNIRH_BATCH_STATIONS) {
    const sites = stations.slice(index, index + SNIRH_BATCH_STATIONS).map((station) => station.site);
    tables.push(...(await readingsTables(definition, sites, first, last, session)));
  }
  const document: SnirhDocument = { kind: "readings", reading, stations, tables };
  if (before) document.before = before;
  const slice: SnirhSlice = { document, sourceUrl: SNIRH_DATABASE_PAGE };
  if (next) slice.next = next;
  return slice;
}

/**
 * The export prints a column only for a station that holds the parameter, and
 * never says which station a column is. When the column count is not the site
 * count the columns cannot be told apart, so the batch is halved until each
 * part lines up; a single site with no column simply holds nothing.
 */
async function readingsTables(definition: SnirhReading, sites: string[], first: string, last: string, session: Session): Promise<SnirhReadingsTable[]> {
  const url = new URL("/snirh/_dadosbase/site/paraCSV/dados_csv.php", session.origin);
  // The export builds its own query string from these without encoding, so the commas stay literal.
  url.search = `?sites=${sites.join(",")}&pars=${definition.parameter}&tmin=${sourceDay(first)}&tmax=${sourceDay(last)}&formato=csv`;
  const csv = new TextDecoder("windows-1252").decode(await download(url, session, "SNIRH station readings"));
  const table = parseReadingsCsv(csv);
  if (table.columns.length === sites.length) {
    for (const column of table.columns) checkColumn(column, definition);
    return [{ sites, csv }];
  }
  if (sites.length === 1) {
    if (table.columns.length === 0) return [];
    throw new GatekeeperError("SNIRH returned several columns for one station and one parameter", "invalid-response");
  }
  const half = Math.ceil(sites.length / 2);
  return [...(await readingsTables(definition, sites.slice(0, half), first, last, session)), ...(await readingsTables(definition, sites.slice(half), first, last, session))];
}

function checkColumn(column: string, definition: SnirhReading): void {
  const expected = `${definition.label} (${definition.unit})`;
  if (column.replace(/\s+/gu, " ").trim().toLowerCase() !== expected.toLowerCase())
    throw new GatekeeperError(`SNIRH labelled a column "${column}" where "${expected}" was asked for`, "invalid-response");
}

/** One parsed CSV export: the label of each column, and each row's time with its value and flag per column. */
export interface SnirhReadingsCsv {
  columns: string[];
  rows: Array<{ time: string; cells: Array<{ value: string; flag: string }> }>;
}

/**
 * The export is a title, a `DATA,` line, a header of `label,FLAG` pairs, one
 * line per time (`dd/mm/yyyy HH:MM`, a fixed UTC clock: a spring clock-change
 * day still has 24 hours) and a closing credit line.
 */
export function parseReadingsCsv(text: string): SnirhReadingsCsv {
  const lines = text.split(/\r?\n/u);
  const dataLine = lines.findIndex((line) => line.trim() === "DATA,");
  if (dataLine < 0) throw new GatekeeperError("SNIRH returned no station readings table", "invalid-response");
  const header = (lines[dataLine + 1] ?? "").split(",");
  if (header[0] !== "") throw new GatekeeperError("SNIRH station readings header is malformed", "invalid-response");
  const columns: string[] = [];
  for (let index = 1; index + 1 < header.length; index += 2) {
    if (header[index + 1] !== "FLAG") throw new GatekeeperError("SNIRH station readings header lost its FLAG pairs", "invalid-response");
    columns.push(header[index] ?? "");
  }
  const rows: SnirhReadingsCsv["rows"] = [];
  for (const line of lines.slice(dataLine + 2)) {
    const time = /^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2}),/u.exec(line);
    if (!time) continue;
    const parts = line.split(",");
    const cells = columns.map((_, index) => ({ value: (parts[1 + index * 2] ?? "").trim(), flag: (parts[2 + index * 2] ?? "").trim() }));
    rows.push({ time: `${time[3]}-${time[2]}-${time[1]}T${time[4]}:${time[5]}:00.000Z`, cells });
  }
  return { columns, rows };
}

/**
 * The stations that measure a parameter. The database keeps its filter in a
 * PHP session, so this takes two requests: post the network, parameter and
 * state as its form does, then read the station list that session now holds.
 */
async function stationList(definition: SnirhReading, state: "ATIVA" | "", session: Session): Promise<SnirhStation[]> {
  const form = new URLSearchParams();
  form.set("f_redes_seleccao[]", definition.network);
  form.set("f_parametros_seleccao[]", definition.parameter);
  form.set("f_estado", state);
  form.set("aplicar_filtro", "1");
  const posted = await request(new URL("/index.php?idMain=2&idItem=1", session.origin), session, "SNIRH station filter", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  // The page itself is not needed, only the session it opened.
  await posted.body?.cancel().catch(() => undefined);
  const cookie = /PHPSESSID=([A-Za-z0-9,-]+)/u.exec(posted.headers.get("set-cookie") ?? "")?.[1];
  if (!cookie) throw new GatekeeperError("SNIRH opened no session for its station filter", "invalid-response");
  const list = await download(new URL("/snirh/_dadosbase/site/xml/xml_listaestacoes.php", session.origin), session, "SNIRH station list", {
    headers: { Cookie: `PHPSESSID=${cookie}` },
  });
  const stations = parseStationList(new TextDecoder().decode(list));
  if (stations.length === 0) throw new GatekeeperError(`SNIRH listed no station measuring ${definition.label}`, "invalid-response");
  return stations;
}

/**
 * The station list's markers. Every one carries an `html` tooltip naming the
 * station and its code (`ESTACAO: _STRONG … STRONG_`, `CÓDIGO: …`), written
 * with HTML entities encoded twice. River and weather stations also carry
 * `estacao="■ NAME (CODE)"` in plain text, which is the better name; wells
 * carry only their code there.
 */
export function parseStationList(xml: string): SnirhStation[] {
  const stations = new Map<string, SnirhStation>();
  for (const marker of xml.matchAll(/<marker\b([^>]*)\/?>/gu)) {
    const attributes = marker[1] ?? "";
    const site = /\bsite="(\d+)"/u.exec(attributes)?.[1];
    const tooltip = decodeEntities(decodeEntities(/\shtml="([^"]*)"/u.exec(attributes)?.[1] ?? ""));
    const code = /DIGO: _STRONG (.*?) STRONG_/u.exec(tooltip)?.[1]?.trim();
    if (!site || !code) continue;
    const label = decodeEntities(/\sestacao="([^"]*)"/u.exec(attributes)?.[1] ?? "")
      .replace(/^\u25A0\s*/u, "")
      .trim();
    const suffix = `(${code})`;
    const name = label.endsWith(suffix) ? label.slice(0, -suffix.length).trim() : (/ESTACAO: _STRONG (.*?) STRONG_/u.exec(tooltip)?.[1]?.trim() ?? code);
    stations.set(site, { site, code, name });
  }
  return [...stations.values()];
}

/* ---------- The monthly bulletins ---------- */

async function precipitationSlice(mode: Mode, session: Session): Promise<SnirhSlice | "exhausted"> {
  const window = monthWindow(mode, PRECIPITATION_FIRST_MONTH);
  if (window === "exhausted") return window;
  const months: Array<{ month: string; xml: string }> = [];
  for (const month of window.months) {
    const [year, number] = monthParts(month);
    const start = number >= 10 ? year : year - 1;
    const url = new URL("/snirh/_dadossintese/precipitacao/flash/coresXML.php", session.origin);
    url.searchParams.set("prec_anoh", `${start}/${String(start + 1).slice(2)}`);
    // Only a two-digit month is understood: `8` answers with every value empty.
    url.searchParams.set("mestarget", String(number).padStart(2, "0"));
    url.searchParams.set("mesTIPO", "mensal");
    months.push({ month, xml: new TextDecoder().decode(await download(url, session, "SNIRH precipitation bulletin")) });
  }
  return withWindow({ kind: "monthly-precipitation", months }, window, `${SNIRH_ORIGIN}/index.php?idMain=1&idItem=1.1`);
}

async function groundwaterSlice(mode: Mode, session: Session): Promise<SnirhSlice | "exhausted"> {
  const window = monthWindow(mode, GROUNDWATER_FIRST_MONTH);
  if (window === "exhausted") return window;
  const months: Array<{ month: string; xml: string }> = [];
  for (const month of window.months) {
    const [year, number] = monthParts(month);
    const url = new URL("/snirh/_dadossintese/agsub/boletim/flash/dadosxml.php", session.origin);
    url.searchParams.set("data_mmyyyy", `${String(number).padStart(2, "0")}/${year}`);
    months.push({ month, xml: new TextDecoder().decode(await download(url, session, "SNIRH groundwater bulletin")) });
  }
  return withWindow({ kind: "groundwater-state", months }, window, `${SNIRH_ORIGIN}/index.php?idMain=1&idItem=1.4&idSubItem=BOL`);
}

/**
 * The reservoir table for a hydrological year (`anohi`, the year of the
 * October it starts) also prints the year before it, so a history slice asks
 * for one and steps back two.
 */
async function reservoirSlice(mode: Mode, session: Session): Promise<SnirhSlice | "exhausted"> {
  let year: number;
  let before: string | undefined;
  let next: HistoryCursor | undefined;
  if (mode.kind === "live") {
    year = hydrologicalYear(utcMonth(mode.now));
  } else {
    before = historyBefore(mode.cursor).toISOString();
    year = hydrologicalYear(utcMonth(new Date(Date.parse(before) - 1)));
    if (year <= RESERVOIR_FIRST_HYDROLOGICAL_YEAR) return "exhausted";
    const earlier = year - 1;
    if (earlier > RESERVOIR_FIRST_HYDROLOGICAL_YEAR) next = { before: `${earlier}-10-01T00:00:00.000Z` };
  }
  const url = new URL("/snirh/_dadossintese/albufeiras/tabelas/tabelageral.php", session.origin);
  url.searchParams.set("albuftblgeralopcao", "1");
  url.searchParams.set("percOUvolum", "1");
  url.searchParams.set("anohi", String(year));
  url.searchParams.set("mes", "09");
  url.searchParams.set("bacia", "");
  url.searchParams.set("albuf", "");
  const html = new TextDecoder("windows-1252").decode(await download(url, session, "SNIRH reservoir bulletin"));
  const document: SnirhDocument = { kind: "reservoir-basins", years: [{ hydrologicalYear: year, html }] };
  if (before) document.before = before;
  const slice: SnirhSlice = { document, sourceUrl: `${SNIRH_ORIGIN}/index.php?idMain=1&idItem=1.3` };
  if (next) slice.next = next;
  return slice;
}

interface MonthWindow {
  months: string[];
  before?: string;
  next?: HistoryCursor;
}

/**
 * Live: the current month and the two before it, since a bulletin can be
 * completed or corrected weeks after its month ends. History: the twelve
 * months before the cursor, until the archive's first month.
 */
function monthWindow(mode: Mode, firstMonth: string): MonthWindow | "exhausted" {
  if (mode.kind === "live") {
    const current = utcMonth(mode.now);
    return { months: [addMonths(current, -2), addMonths(current, -1), current] };
  }
  const before = historyBefore(mode.cursor).toISOString();
  const last = utcMonth(new Date(Date.parse(before) - 1));
  if (last < firstMonth) return "exhausted";
  const months: string[] = [];
  for (let offset = 11; offset >= 0; offset -= 1) {
    const month = addMonths(last, -offset);
    if (month >= firstMonth) months.push(month);
  }
  const first = months[0] ?? last;
  const window: MonthWindow = { months, before };
  if (first > firstMonth) window.next = { before: `${first}-01T00:00:00.000Z` };
  return window;
}

function withWindow(document: SnirhDocument, window: MonthWindow, sourceUrl: string): SnirhSlice {
  if (window.before) document.before = window.before;
  const slice: SnirhSlice = { document, sourceUrl };
  if (window.next) slice.next = window.next;
  return slice;
}

/* ---------- Transport ---------- */

async function request(url: URL, session: Session, what: string, init: RequestInit = {}): Promise<Response> {
  if (url.origin !== session.origin) throw new GatekeeperError(`${what} would leave ${session.origin}`, "source-denied");
  let response: Response;
  try {
    response = await session.fetcher(url, { ...init, redirect: "manual", headers: { Accept: "*/*", "User-Agent": "open-data.pt", ...init.headers } });
  } catch (error) {
    throw new GatekeeperError(`${what} request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if (response.status >= 300 && response.status < 400) throw new GatekeeperError(`${what} redirected`, "source-denied");
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new GatekeeperError(`${what} returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  }
  return response;
}

async function download(url: URL, session: Session, what: string, init: RequestInit = {}): Promise<Uint8Array> {
  const response = await request(url, session, what, init);
  if (session.remaining <= 0) throw new GatekeeperError(`SNIRH collection exceeds ${SNIRH_MAX_BYTES} bytes`, "response-too-large");
  const bytes = await readBoundedResponse(response, session.remaining, what);
  session.remaining -= bytes.byteLength;
  return bytes;
}

/* ---------- Calendar ---------- */

function historyBefore(cursor: HistoryCursor): Date {
  const before = new Date(cursor.before);
  if (Number.isNaN(before.getTime())) throw new GatekeeperError("SNIRH history cursor.before must be an ISO 8601 date-time", "invalid-config");
  return before;
}

function utcDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcMonth(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function addDays(day: string, amount: number): string {
  return utcDay(new Date(Date.parse(`${day}T00:00:00.000Z`) + amount * DAY_MS));
}

function addMonths(month: string, amount: number): string {
  const [year, number] = monthParts(month);
  const date = new Date(Date.UTC(year, number - 1 + amount, 1));
  return utcMonth(date);
}

function monthParts(month: string): [number, number] {
  return [Number(month.slice(0, 4)), Number(month.slice(5, 7))];
}

/** The October-to-September year a month belongs to, named by the year of its October. */
function hydrologicalYear(month: string): number {
  const [year, number] = monthParts(month);
  return number >= 10 ? year : year - 1;
}

/** `YYYY-MM-DD` as the database's forms write it. */
function sourceDay(day: string): string {
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/** Combining marks for the accented-letter entities SNIRH writes (`&Atilde;`, `&ccedil;`). */
const ACCENTS = new Map([
  ["acute", "\u0301"],
  ["grave", "\u0300"],
  ["circ", "\u0302"],
  ["tilde", "\u0303"],
  ["uml", "\u0308"],
  ["cedil", "\u0327"],
]);

/** The entities SNIRH's XML and HTML carry: numeric references, the XML names, `&nbsp;` and accented letters. */
export function decodeEntities(text: string): string {
  return text
    .replace(/&([A-Za-z])(acute|grave|circ|tilde|uml|cedil);/gu, (_, letter: string, accent: string) => `${letter}${ACCENTS.get(accent) ?? ""}`.normalize("NFC"))
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp|ordm|ordf);/giu, (_, entity: string) => {
      const lower = entity.toLowerCase();
      if (lower.startsWith("#x")) return String.fromCodePoint(Number.parseInt(lower.slice(2), 16));
      if (lower.startsWith("#")) return String.fromCodePoint(Number(lower.slice(1)));
      return (
        new Map([
          ["amp", "&"],
          ["lt", "<"],
          ["gt", ">"],
          ["quot", '"'],
          ["apos", "'"],
          ["nbsp", " "],
          ["ordm", "º"],
          ["ordf", "ª"],
        ]).get(lower) ?? ""
      );
    });
}
