import {
  GatekeeperError,
  contentEtag,
  fixedOrigin,
  invalidResponse,
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
} from "../../index";

/** The one origin MYINFO answers on; every operator is a folder under it. */
export const MYINFO_ORIGIN = "https://myinfo.4cloud.pt";
/** Where an operator's portal lives, and the page a person can open. */
export function myInfoPortalUrl(origin: string, operator: string): string {
  return `${origin}/IP/MotorBusca/${operator}/`;
}

/** A landing page carries the whole stop network inline; Barraqueiro Oeste's is 2.3 MB. */
const PAGE_MAX_BYTES = 12 * 1024 * 1024;
/** A search answer is a page of results, an order of magnitude smaller. */
const RESULT_MAX_BYTES = 4 * 1024 * 1024;
/** Everything one collection assembles, before the policy's own source cap applies. */
export const MYINFO_MAX_BYTES = 8 * 1024 * 1024;

/** An operator folder name, as it appears in the portal's path. */
const OPERATOR = /^[A-Za-z][A-Za-z0-9]{1,39}$/u;
/** A zone identifier, as the origin and destination lists give it. */
const ZONE_ID = /^[0-9]{1,12}$/u;

export const MYINFO_FEEDS = {
  network: {
    kind: "network",
    title: "Stops and lines",
    description: "Every stop the operator serves, with its position and the lines that call there, and every line with its number and name.",
    semantics: {
      domainSubject: "feature",
      defaultProductRole: "reference",
    },
  },
  timetable: {
    kind: "timetable",
    title: "Departures between two places",
    description: "Every scheduled departure between one origin and one destination, with its arrival, journey time, lines and the days it runs.",
    semantics: {
      domainSubject: "reference",
      defaultProductRole: "reference",
    },
  },
} as const satisfies Record<string, FeedKindDescription>;

export type MyInfoFeedName = keyof typeof MYINFO_FEEDS;

/** One stop of an operator's network, as the portal's map data states it. */
export interface MyInfoStop {
  stopId: string;
  stopCode: string | null;
  zoneId: string;
  name: string;
  longitude: number | null;
  latitude: number | null;
  /** The lines calling here, by their `<lineId>|GOING`/`|RETURN` key. */
  lineKeys: string[];
}

/** One line and direction, named once however many stops it calls at. */
export interface MyInfoLine {
  key: string;
  lineId: string;
  code: string;
  name: string;
  /** `GOING` or `RETURN`, as the line key spells it. */
  direction: string;
}

/** One searchable place: what the origin and destination lists offer. */
export interface MyInfoZone {
  id: string;
  name: string;
}

/** One scheduled journey a search returned. */
export interface MyInfoTrip {
  departure: string;
  arrival: string;
  /** The journey time the portal states, as `HH:MM`. */
  duration: string;
  /** The line numbers used, in order; more than one means a transfer. */
  routes: string[];
  /** Where and when to change, as the portal writes it, or null for a direct journey. */
  transfer: string | null;
  /** The days this departure runs, in the operator's own words ("Dias úteis"). */
  frequency: string;
}

/** Everything one collection read from a portal, handed to the normalizer as one JSON document. */
export type MyInfoDocument =
  | { feed: "network"; operator: string; stops: MyInfoStop[]; lines: MyInfoLine[]; zones: MyInfoZone[] }
  | { feed: "timetable"; operator: string; origin: MyInfoZone; destination: MyInfoZone; trips: MyInfoTrip[] };

export function validateMyInfoFeedConfig(config: SourceConfig, operators: ReadonlySet<string>): SourceConfig {
  const feed = config.feed;
  if (!isMyInfoFeedName(feed)) {
    throw new GatekeeperError(`MYINFO feeds require feed=${Object.keys(MYINFO_FEEDS).join(", ")}`, "invalid-config");
  }
  const expected = feed === "timetable" ? ["feed", "operator", "origin", "destination"] : ["feed", "operator"];
  const unexpected = Object.keys(config).filter((key) => !expected.includes(key));
  if (unexpected.length > 0) {
    throw new GatekeeperError(`Unsupported MYINFO configuration field: ${unexpected[0]}`, "invalid-config");
  }
  const operator = config.operator;
  if (operator === undefined || !OPERATOR.test(operator)) {
    throw new GatekeeperError("MYINFO feeds require an operator folder name", "invalid-config");
  }
  if (!operators.has(operator)) {
    throw new GatekeeperError(`MYINFO operator is not allowed: ${operator}`, "source-denied");
  }
  if (feed !== "timetable") return { feed, operator };
  const { origin, destination } = config;
  if (origin === undefined || !ZONE_ID.test(origin) || destination === undefined || !ZONE_ID.test(destination)) {
    throw new GatekeeperError("MYINFO timetable feeds require numeric origin and destination zone identifiers", "invalid-config");
  }
  if (origin === destination) {
    throw new GatekeeperError("MYINFO timetable origin and destination must differ", "invalid-config");
  }
  return { feed, operator, origin, destination };
}

export async function collectMyInfoFeed(
  config: SourceConfig,
  checkpoint: SourceValidator | undefined,
  apiOrigin: string,
  operators: ReadonlySet<string>,
  fetcher: typeof fetch,
): Promise<SourceFetch> {
  const valid = validateMyInfoFeedConfig(config, operators);
  const origin = fixedOrigin(apiOrigin, MYINFO_ORIGIN);
  const operator = valid.operator!;
  const portal = myInfoPortalUrl(origin, operator);
  const landing = await readPortalPage(portal, undefined, fetcher);
  const page = decoder.decode(landing.bytes);

  let document: MyInfoDocument;
  if (valid.feed === "network") {
    const network = parseNetwork(page);
    document = { feed: "network", operator, stops: network.stops, lines: network.lines, zones: parseZones(page) };
  } else {
    // The search is a WebForms postback: the page's own hidden fields, its session
    // cookie, and the two places. Without the cookie the application answers 500.
    const zones = parseZones(page);
    // A portal that offers nowhere is a page that answered but is not the one this
    // reads; a portal that offers places but not these two is a feed configured wrong.
    if (zones.length === 0) throw invalidResponse(`MYINFO page ${portal} offers no places to travel between`);
    const origins = new Map(zones.map((zone) => [zone.id, zone]));
    const from = origins.get(valid.origin!);
    const to = origins.get(valid.destination!);
    if (!from || !to) {
      throw new GatekeeperError(`MYINFO ${operator} does not offer origin ${valid.origin!} and destination ${valid.destination!}`, "invalid-config");
    }
    const results = await search(portal, page, landing.session, from.id, to.id, fetcher);
    document = { feed: "timetable", operator, origin: from, destination: to, trips: parseTrips(results) };
  }

  const body = new TextEncoder().encode(JSON.stringify(document));
  if (body.byteLength > MYINFO_MAX_BYTES) {
    throw new GatekeeperError(`MYINFO ${operator} ${valid.feed} collection exceeded ${MYINFO_MAX_BYTES} bytes`, "response-too-large");
  }
  // The portal sends `Cache-Control: private` and no validator of its own, so the
  // content is its own: an identical collection is unchanged.
  const validator: SourceValidator = { etag: await contentEtag(body) };
  if (checkpoint?.etag === validator.etag) return { kind: "not-modified", validator };
  return {
    kind: "body",
    body,
    provenance: { sourceUrl: portal },
    completeness: "complete",
    validator,
  };
}

const decoder = new TextDecoder();

interface PortalPage {
  bytes: Uint8Array;
  /** The ASP.NET session the search postback has to come back with. */
  session: string | undefined;
}

/** A search postback: the form the page handed back, under the session it opened. */
interface Postback {
  body: string;
  session: string | undefined;
}

async function readPortalPage(url: string, postback: Postback | undefined, fetcher: typeof fetch): Promise<PortalPage> {
  const headers = new Headers({ Accept: "text/html" });
  const init: RequestInit = { redirect: "manual", headers };
  if (postback !== undefined) {
    init.method = "POST";
    init.body = postback.body;
    headers.set("Content-Type", "application/x-www-form-urlencoded");
    headers.set("Referer", url);
    if (postback.session !== undefined) headers.set("Cookie", postback.session);
  }
  const response = await fetcher(url, init);
  if (!response.ok) {
    throw new GatekeeperError(`MYINFO returned HTTP ${response.status} for ${url}`, "upstream-error", retryAfterSeconds(response.headers));
  }
  const bytes = await readBoundedResponse(response, postback === undefined ? PAGE_MAX_BYTES : RESULT_MAX_BYTES, `MYINFO page ${url}`);
  return { bytes, session: sessionCookie(response.headers.get("set-cookie")) };
}

/** The `ASP.NET_SessionId` pair out of whatever form the runtime joined the cookies in. */
function sessionCookie(header: string | null): string | undefined {
  const found = /ASP\.NET_SessionId=([^;,\s]+)/u.exec(header ?? "");
  return found ? `ASP.NET_SessionId=${found[1]!}` : undefined;
}

/** The postback that asks for every departure between two places on the page's own date. */
async function search(portal: string, page: string, session: string | undefined, origin: string, destination: string, fetcher: typeof fetch): Promise<string> {
  const form = parseFormFields(page);
  if (!form.has("__VIEWSTATE")) throw invalidResponse(`MYINFO page ${portal} carried no form to search with`);
  // Selecting a line instead of two places raises NotImplementedException upstream,
  // so a search always names both places and leaves the line list alone.
  form.set("ctl00$MainContent$ddlLine", "0");
  form.set("ctl00$MainContent$ddlOrigin", origin);
  form.set("ctl00$MainContent$ddlDestination", destination);
  // The form opens at the current time, which would answer with the rest of today
  // and nothing before it. Midnight asks for the whole day, whenever it is asked.
  form.set("ctl00$MainContent$txtOriginHour", "00:00");
  form.set("ctl00$MainContent$btnSearch", "Pesquisar");
  const answer = await readPortalPage(portal, { body: new URLSearchParams([...form]).toString(), session }, fetcher);
  return decoder.decode(answer.bytes);
}

/** Every hidden and text field of the page's one form, as the browser would post them back. */
export function parseFormFields(page: string): Map<string, string> {
  const fields = new Map<string, string>();
  for (const tag of page.match(/<input\b[^>]*>/gu) ?? []) {
    const name = attribute(tag, "name");
    if (name === undefined) continue;
    const type = (attribute(tag, "type") ?? "text").toLowerCase();
    if (type === "submit" || type === "image" || type === "button") continue;
    // An unchecked box posts nothing, and every box on this page starts unchecked.
    if ((type === "checkbox" || type === "radio") && !/\bchecked\b/u.test(tag)) continue;
    fields.set(name, attribute(tag, "value") ?? "");
  }
  return fields;
}

/** An operator's whole network: every stop, and every line and direction calling at one. */
export interface MyInfoNetwork {
  stops: MyInfoStop[];
  lines: MyInfoLine[];
}

/**
 * The stop network and its lines, from the one URL-encoded JSON array the page
 * hands its map. The stop table is an authoritative snapshot, so what this
 * leaves out a collection deletes: a page without its network, or an entry
 * missing what a stop is made of, is a failure rather than a smaller network.
 */
export function parseNetwork(page: string): MyInfoNetwork {
  const found = NETWORK_PAYLOAD.exec(page);
  if (!found) throw invalidResponse("MYINFO page carried no stop network");
  let decoded: JsonValue;
  try {
    decoded = parseJson(decodeURIComponent(found[1]!.replace(/\+/gu, " ")));
  } catch {
    throw invalidResponse("MYINFO stop data was not valid JSON");
  }
  if (!isJsonArray(decoded)) throw invalidResponse("MYINFO stop data was not a list");
  const stops: MyInfoStop[] = [];
  const seen = new Set<string>();
  const lines = new Map<string, MyInfoLine>();
  for (const [index, entry] of decoded.entries()) {
    if (!isJsonObject(entry)) throw invalidResponse(`MYINFO stop ${index} is not an object`);
    const stopId = requiredIdentifier(entry.StopId, index, "StopId");
    // A copy this entry turns out to be is discarded whole, so the lines it names
    // wait here: a line the line table publishes is one some kept stop calls at.
    const named = new Map<string, MyInfoLine>();
    // The portal spells the stop's name `StopNane`; that typo is its field name.
    const stop: MyInfoStop = {
      stopId,
      stopCode: text(entry.StopCode) ?? null,
      zoneId: requiredIdentifier(entry.ZoneId, index, "ZoneId"),
      name: requiredText(entry.StopNane, index, "StopNane"),
      longitude: coordinate(entry.CoordX, 180),
      latitude: coordinate(entry.CoordY, 90),
      lineKeys: collectLines(entry.StopLines, lines, named, index),
    };
    // One stop listed twice is one stop, not two: the first entry is the stop, and
    // the copy is still read in full, because an unreadable copy is an unreadable page.
    if (seen.has(stopId)) continue;
    seen.add(stopId);
    stops.push(stop);
    for (const [key, line] of named) lines.set(key, line);
  }
  return { stops, lines: [...lines.values()] };
}

/** The whole network, URL-encoded, in the argument the page hands its map. */
const NETWORK_PAYLOAD = /'(%5[bB]%7[bB]%22StopId%22[^']*)'/u;
/** A line key names its line and which way it runs; a stop references a line by it. */
const LINE_KEY = /^(\d{1,12})\|(GOING|RETURN)$/u;

/**
 * The lines calling at one stop, by key, while naming the ones not named yet in
 * `named`. The stop data repeats a line's number and name at every stop it
 * serves; the line list is where they are published, and a stop keeps the keys.
 * A key a line list cannot name would leave the stop pointing at nothing, so an
 * entry is either complete or the collection fails.
 */
function collectLines(value: JsonValue | undefined, lines: ReadonlyMap<string, MyInfoLine>, named: Map<string, MyInfoLine>, stop: number): string[] {
  if (!isJsonArray(value)) throw invalidResponse(`MYINFO stop ${stop} does not list the lines calling there`);
  const keys: string[] = [];
  for (const [index, line] of value.entries()) {
    const at = `MYINFO stop ${stop} line ${index}`;
    if (!isJsonObject(line)) throw invalidResponse(`${at} is not an object`);
    const key = requiredText(line.Key, stop, `StopLines[${index}].Key`);
    const parsed = LINE_KEY.exec(key);
    if (!parsed) throw invalidResponse(`${at} has an unreadable key: ${key}`);
    if (!keys.includes(key)) keys.push(key);
    if (lines.has(key) || named.has(key)) continue;
    const lineId = requiredIdentifier(line.Id, stop, `StopLines[${index}].Id`);
    if (lineId !== parsed[1]) throw invalidResponse(`${at} names line ${lineId} under the key of line ${parsed[1]!}`);
    named.set(key, {
      key,
      lineId,
      code: requiredText(line.Code, stop, `StopLines[${index}].Code`),
      name: requiredText(line.Name, stop, `StopLines[${index}].Name`),
      direction: parsed[2]!,
    });
  }
  return keys;
}

/** A value a stop is made of: the portal states it, or the page is not one this reads. */
function requiredText(value: JsonValue | undefined, index: number, field: string): string {
  const found = text(value);
  if (found === undefined) throw invalidResponse(`MYINFO stop ${index} states no ${field}`);
  return found;
}

function requiredIdentifier(value: JsonValue | undefined, index: number, field: string): string {
  const found = identifier(value);
  if (found === undefined) throw invalidResponse(`MYINFO stop ${index} states no ${field}`);
  return found;
}

/** The places a search may name: the origin list, which is the destination list too. */
export function parseZones(page: string): MyInfoZone[] {
  const list = /<select\b[^>]*\bid="ddlOrigin"[\s\S]*?<\/select>/u.exec(page);
  if (!list) return [];
  const zones: MyInfoZone[] = [];
  const seen = new Set<string>();
  for (const option of list[0].match(/<option\b[^>]*>[\s\S]*?<\/option>/gu) ?? []) {
    const id = attribute(option, "value");
    const name = plainText(option);
    if (id === undefined || !ZONE_ID.test(id) || id === "0" || name === "" || seen.has(id)) continue;
    seen.add(id);
    zones.push({ id, name });
  }
  return zones;
}

/**
 * The departures a search answered with. Every row of the results table is one
 * journey; a journey with a transfer names both lines and where to change.
 */
export function parseTrips(page: string): MyInfoTrip[] {
  const trips: MyInfoTrip[] = [];
  for (const table of page.match(/<table\b[\s\S]*?<\/table>/gu) ?? []) {
    if (!table.includes("showRouteDetails")) continue;
    for (const row of table.match(/<tr\b[\s\S]*?<\/tr>/gu) ?? []) {
      const cells = (row.match(/<td\b[\s\S]*?<\/td>/gu) ?? []).map(plainText);
      if (cells.length < 7) continue;
      const [departure, arrival, duration, carriers, , where, frequency] = cells;
      if (!isClock(departure) || !isClock(arrival) || !isClock(duration)) continue;
      const routes = (carriers ?? "")
        .split("/")
        .map((code) => code.trim())
        .filter((code) => code !== "");
      if (routes.length === 0) continue;
      const transfer = (where ?? "").replace(/^-+$/u, "").trim();
      trips.push({
        departure: departure!,
        arrival: arrival!,
        duration: duration!,
        routes,
        transfer: transfer === "" ? null : transfer,
        frequency: (frequency ?? "").trim(),
      });
    }
  }
  return trips;
}

function attribute(tag: string, name: string): string | undefined {
  const found = new RegExp(`\\b${name}="([^"]*)"`, "u").exec(tag);
  return found ? decodeEntities(found[1]!) : undefined;
}

/** A cell's or option's own words: its tags removed, its entities read, its whitespace collapsed. */
function plainText(html: string): string {
  return decodeEntities(html.replace(/<[^>]*>/gu, " "))
    .replace(/\s+/gu, " ")
    .trim();
}

const ENTITIES = new Map([
  ["amp", "&"],
  ["lt", "<"],
  ["gt", ">"],
  ["quot", '"'],
  ["apos", "'"],
  ["nbsp", " "],
  ["ensp", " "],
  ["emsp", " "],
]);

function decodeEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/gu, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X") ? Number.parseInt(body.slice(2), 16) : Number.parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES.get(body.toLowerCase()) ?? whole;
  });
}

function isClock(value: string | undefined): value is string {
  return value !== undefined && /^\d{1,2}:\d{2}$/u.test(value);
}

/** A coordinate the portal states; a stop it has not placed sits at the null island, which is not a position. */
function coordinate(value: JsonValue | undefined, bound: number): number | null {
  if (!isJsonNumber(value) || !Number.isFinite(value) || Math.abs(value) > bound || value === 0) return null;
  return value;
}

function identifier(value: JsonValue | undefined): string | undefined {
  if (isJsonNumber(value) && Number.isSafeInteger(value)) return String(value);
  return text(value);
}

function text(value: JsonValue | undefined): string | undefined {
  if (!isJsonString(value)) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function isMyInfoFeedName(value: string | undefined): value is MyInfoFeedName {
  return value !== undefined && Object.hasOwn(MYINFO_FEEDS, value);
}

/** The document a collection assembled, read back by the normalizer. */
export function myInfoDocument(value: JsonValue): JsonObject {
  if (!isJsonObject(value) || !isJsonString(value.feed)) throw new Error("MYINFO collection document has no feed");
  return value;
}
