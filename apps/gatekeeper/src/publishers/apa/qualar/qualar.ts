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
  type FeedKindDescription,
  type JsonObject,
  type JsonValue,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
} from "#/index";

/**
 * QualAr, APA's air quality information system. Its app reads a JSON API (`/api/app.php?type=…`); this library reads
 * `type=medicoes`, which answers, for one day, every station of the national network with the latest hour it has
 * measured of each pollutant: its value, whether it is validated, and its air quality index. The stations are run by
 * the regional coordination commissions (CCDR); APA publishes them.
 *
 * Hours are UTC, which is mainland Portugal's standard time and what EU air quality reporting uses. QualAr does not
 * say so; the traffic stations show it: nitrogen dioxide at Avenida da Liberdade and Entrecampos peaks at hour 7 on a
 * working day, 08:00 in Lisbon in summer, and again at 17 to 18.
 */
export const QUALAR_ORIGIN = "https://qualar.apambiente.pt";
/** One day's answer is about 70 KB. */
const DAY_MAX_BYTES = 1024 * 1024;

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

/** What a collection hands its transform: each day asked for, with its pollutants and each station's latest hours. */
export interface QualarDocument {
  days: Array<{ date: string; pollutants: JsonObject[]; stations: JsonObject[] }>;
}

/**
 * Today and yesterday, by the UTC calendar: `medicoes` answers only the latest hour of the day asked for, so the hours
 * that close a day are read from the day before until the next one has begun.
 */
export async function collectQualarFeed(
  config: SourceConfig,
  checkpoint: SourceValidator | undefined,
  apiOrigin: string,
  fetcher: typeof fetch,
  now: Date = new Date(),
): Promise<SourceFetch> {
  validateQualarFeedConfig(config);
  const origin = fixedOrigin(apiOrigin, QUALAR_ORIGIN);
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - 86_400_000).toISOString().slice(0, 10);
  const document: QualarDocument = { days: [] };
  for (const date of [yesterday, today]) document.days.push({ date, ...(await day(origin, date, fetcher)) });
  const body = new TextEncoder().encode(JSON.stringify(document));
  const validator: SourceValidator = { etag: await contentEtag(body) };
  if (checkpoint?.etag === validator.etag) return { kind: "not-modified", validator };
  return { kind: "body", body, provenance: { sourceUrl: `${origin}/` }, completeness: "complete", validator };
}

async function day(origin: string, date: string, fetcher: typeof fetch): Promise<{ pollutants: JsonObject[]; stations: JsonObject[] }> {
  const url = new URL("/api/app.php", origin);
  url.search = `?type=medicoes&data=${date}&en=0`;
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
    value = parseJsonBytes(await readBoundedResponse(response, DAY_MAX_BYTES, "QualAr measurements"));
  } catch (error) {
    if (error instanceof GatekeeperError) throw error;
    throw new GatekeeperError("QualAr answered something that is not JSON", "invalid-response");
  }
  if (!isJsonObject(value) || !isJsonArray(value.colunas) || !isJsonArray(value.estacoes))
    throw new GatekeeperError("QualAr measurements have no pollutants or no stations", "invalid-response");
  const pollutants = value.colunas.filter(isJsonObject).map((column) => ({
    id: isJsonNumber(column.poluente_id) ? column.poluente_id : null,
    pollutant: isJsonString(column.poluente_abrev) ? column.poluente_abrev.trim() : null,
    averaging: isJsonString(column.texto) ? column.texto.trim() : null,
    unit: isJsonString(column.unidade) ? column.unidade.trim() : null,
  }));
  // Only what is published: the station and each pollutant's latest hour. The rest of a station (its address, its
  // network) is the air quality stations feed's.
  const stations = value.estacoes.filter(isJsonObject).map((station) => ({
    station: isJsonNumber(station.estacao_id) ? station.estacao_id : null,
    name: isJsonString(station.estacao_nome) ? station.estacao_nome.trim() : null,
    readings: isJsonArray(station.medicoes) ? station.medicoes : [],
  }));
  return { pollutants, stations };
}
