import {
  GatekeeperError,
  contentEtag,
  fixedOrigin,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  sourceValidator,
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "#/index";

/**
 * QualAr, APA's air quality information system. Its app reads a JSON API (`/api/app.php?type=…`), and this library
 * reads two of its answers. `type=medicoes` answers, for the day under way, every station of the national network
 * with the latest hour it has measured of each pollutant; for a day that has ended it answers each pollutant's
 * maximum instead, so the hours that close a day never show there. `type=dados` answers one station's 24 hours of a
 * day. Every collection reads the first; once a day, the second, for every station and the day before. The stations
 * are run by the regional coordination commissions (CCDR); APA publishes them.
 *
 * Hours are UTC, which is mainland Portugal's standard time and what EU air quality reporting uses. QualAr does not
 * say so; the traffic stations show it: nitrogen dioxide at Avenida da Liberdade and Entrecampos peaks at hour 7 on a
 * working day, 08:00 in Lisbon in summer, and again at 17 to 18.
 */
export const QUALAR_ORIGIN = "https://qualar.apambiente.pt";
/** One day's answer for every station is about 70 KB; one station's day is about 3 KB. */
const DAY_MAX_BYTES = 1024 * 1024;
/** A day's last hours reach QualAr about two hours late: the day before is read whole from this hour of the next. */
const SWEEP_FROM_UTC_HOUR = 3;

export const QUALAR_FEEDS = {
  // The latest hourly reading of each pollutant at every station of the national air quality network.
  "air-quality": {
    kind: "air-quality",
    semantics: { domainSubject: "observation", defaultProductRole: "time-series" },
  },
} as const satisfies Record<string, FeedKindDescription>;

export function validateQualarFeedConfig(config: SourceConfig): SourceConfig {
  for (const key of Object.keys(config))
    if (key !== "feed") throw new GatekeeperError(`Unsupported QualAr field: ${key}`, key === "host" || key === "url" ? "source-denied" : "invalid-config");
  if (config.feed?.trim() !== "air-quality") throw new GatekeeperError("QualAr feeds require feed=air-quality", "invalid-config");
  return { feed: "air-quality" };
}

/** One pollutant of an answer: QualAr's identifier and abbreviation, how its value is averaged, and its unit. */
interface QualarColumn {
  id: number | null;
  pollutant: string | null;
  averaging: string | null;
  unit: string | null;
}

/**
 * What a collection hands its transform: the day under way, with each station's latest hour of each pollutant; and,
 * on the collection that reads it, the day before, with each station's every hour.
 */
export interface QualarDocument {
  latest: { date: string; pollutants: JsonObject[]; stations: JsonObject[] };
  day?: { date: string; stations: JsonObject[] };
}

/**
 * The latest hours of today, by the UTC calendar, and, the first time each day after 03:00 UTC, all of yesterday's
 * hours, station by station. `state` says which day was last read whole.
 */
export async function collectQualarFeed(
  config: SourceConfig,
  state: JsonObject | undefined,
  apiOrigin: string,
  fetcher: typeof fetch,
  now: Date = new Date(),
): Promise<SourceFetch> {
  validateQualarFeedConfig(config);
  const origin = fixedOrigin(apiOrigin, QUALAR_ORIGIN);
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  const latest = await answer(origin, `type=medicoes&data=${today}&en=0`, fetcher);
  if (!isJsonArray(latest.colunas) || !isJsonArray(latest.estacoes)) throw new GatekeeperError("QualAr measurements have no pollutants or no stations", "invalid-response");
  // Only what is published: the station and each pollutant's latest hour. The rest of a station (its address, its
  // network) is the air quality stations feed's.
  const stations = latest.estacoes.filter(isJsonObject).map((station) => ({
    station: isJsonNumber(station.estacao_id) ? station.estacao_id : null,
    name: isJsonString(station.estacao_nome) ? station.estacao_nome.trim() : null,
    readings: isJsonArray(station.medicoes) ? station.medicoes : [],
  }));
  const document: QualarDocument = { latest: { date: today, pollutants: latest.colunas.map(column), stations } };

  let sweptDay = isJsonString(state?.sweptDay) ? state.sweptDay : undefined;
  let missing = 0;
  if (sweptDay !== yesterday && now.getUTCHours() >= SWEEP_FROM_UTC_HOUR) {
    const swept: JsonObject[] = [];
    for (const station of stations) {
      if (station.station === null) continue;
      try {
        const hours = await answer(origin, `type=dados&data=${yesterday}&estacao_id=${station.station}&range=1&en=0`, fetcher);
        swept.push({
          station: station.station,
          name: station.name,
          pollutants: isJsonArray(hours.cols) ? hours.cols.map(column) : [],
          values: isJsonArray(hours.vals) ? hours.vals : [],
        });
      } catch (error) {
        // One station's day that does not answer costs that station, not the other seventy.
        if (!(error instanceof GatekeeperError) || (error.code !== "upstream-error" && error.code !== "invalid-response")) throw error;
        missing += 1;
      }
    }
    if (swept.length === 0) throw new GatekeeperError(`QualAr answered no station's hours of ${yesterday}`, "upstream-error");
    document.day = { date: yesterday, stations: swept };
    sweptDay = yesterday;
  }

  const body = new TextEncoder().encode(JSON.stringify(document));
  const validator: SourceValidator = { etag: await contentEtag(body) };
  if (sourceValidator(state)?.etag === validator.etag) return { kind: "not-modified", validator };
  const next: JsonObject = { validators: { default: { etag: validator.etag ?? "" } } };
  if (sweptDay) next.sweptDay = sweptDay;
  return { kind: "body", body, provenance: { sourceUrl: `${origin}/` }, completeness: missing > 0 ? "partial" : "complete", state: next };
}

function column(value: JsonValue): JsonObject {
  const entry = isJsonObject(value) ? value : {};
  const described: QualarColumn = {
    id: isJsonNumber(entry.poluente_id) ? entry.poluente_id : null,
    pollutant: isJsonString(entry.poluente_abrev) ? entry.poluente_abrev.trim() : null,
    averaging: isJsonString(entry.texto) ? entry.texto.trim() : null,
    unit: isJsonString(entry.unidade) ? entry.unidade.trim() : null,
  };
  return { ...described };
}

/** One answer of QualAr's app API, as the JSON object it is. */
async function answer(origin: string, query: string, fetcher: typeof fetch): Promise<JsonObject> {
  const url = new URL("/api/app.php", origin);
  url.search = `?${query}`;
  let response: Response;
  try {
    response = await fetcher(url, { headers: { Accept: "application/json" }, redirect: "manual" });
  } catch (error) {
    throw new GatekeeperError(`QualAr request failed: ${error instanceof Error ? error.message : "network failure"}`, "upstream-error");
  }
  if (response.status >= 300 && response.status < 400) throw new GatekeeperError("QualAr redirected", "source-denied");
  if (!response.ok) throw new GatekeeperError(`QualAr returned HTTP ${response.status}`, "upstream-error", retryAfterSeconds(response.headers));
  let value: JsonValue;
  try {
    value = parseJsonBytes(await readBoundedResponse(response, DAY_MAX_BYTES, "QualAr answer"));
  } catch (error) {
    if (error instanceof GatekeeperError) throw error;
    throw new GatekeeperError("QualAr answered something that is not JSON", "invalid-response");
  }
  if (!isJsonObject(value)) throw new GatekeeperError("QualAr answered something that is not an object", "invalid-response");
  return value;
}
