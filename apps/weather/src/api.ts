/**
 * Everything the site shows, read in the browser from open-data.pt's public API. open-data.pt
 * serves IPMA's rows as IPMA publishes them; this file only says what shape each product's rows
 * have and reads them. Whatever is worked out from them is worked out by the page that shows it.
 */

/** open-data.pt, or a kernel run with `pnpm dev` when the build is given `VITE_OPEN_DATA_API`. */
const API = `${import.meta.env["VITE_OPEN_DATA_API"] ?? "https://open-data.pt"}/api/products`;

async function read<Row>(path: string): Promise<Row[]> {
  const answer = await fetch(`${API}/${path}`);
  if (!answer.ok) throw new Error(`open-data.pt respondeu ${answer.status} a ${path}`);
  // SAFETY: every list open-data.pt answers is `{ data: [...] }`, and each caller names the product whose rows it reads.
  return ((await answer.json()) as { data: Row[] }).data;
}

/** One value of a series at one time. */
export interface SeriesPoint {
  seriesKey: string;
  eventTime: string;
  value: number;
  unit: string;
}

/** `ipma-forecast-daily`: one city on one day. */
export interface CityForecast {
  cityId: string;
  city: string;
  latitude: number;
  longitude: number;
  forecastDate: string;
  weatherType: string;
  weatherTypeId: string;
  minimumTemperature: number | null;
  maximumTemperature: number | null;
  precipitationProbability: number | null;
  windDirection: string | null;
  windSpeedClass: string | null;
}

/** `ipma-warnings`: one warning for one area, of one kind, over one period. */
export interface Warning {
  areaCode: string;
  type: string;
  level: string;
  startTime: string;
  endTime: string;
  text: string | null;
}

/** `ipma-stations-latest`: a station and what it last measured. */
export interface StationReading {
  stationId: string;
  stationName: string;
  latitude: number;
  longitude: number;
  observationTime: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection: string | null;
  precipitation: number | null;
  pressure: number | null;
  radiation: number | null;
}

/** `ipma-sea-forecast`: one stretch of coast on one day. */
export interface SeaForecast {
  locationId: string;
  location: string;
  latitude: number;
  longitude: number;
  forecastDate: string;
  waveDirection: string | null;
  wavePeriodMin: number | null;
  wavePeriodMax: number | null;
  totalSeaMin: number | null;
  totalSeaMax: number | null;
  waveHeightMin: number | null;
  waveHeightMax: number | null;
  seaSurfaceTemperatureMin: number | null;
  seaSurfaceTemperatureMax: number | null;
}

/** `ipma-uv-index`: the UV index forecast for one place on one day. */
export interface UvForecast {
  locationId: string;
  location: string;
  latitude: number;
  longitude: number;
  date: string;
  period: string | null;
  uvIndex: number;
}

/** `ipma-fire-risk`: a municipality's rural fire danger on one day. */
export interface FireRisk {
  municipalityCode: string;
  latitude: number;
  longitude: number;
  riskLevel: number;
  riskLabel: string;
  forecastDate: string;
}

/** `ipma-earthquakes`. */
export interface Earthquake {
  id: string;
  time: string;
  latitude: number;
  longitude: number;
  magnitude: number | null;
  depth: number | null;
  region: string | null;
  sensed: string | boolean | null;
}

/** `ipma-lightning-discharges`. */
export interface Discharge {
  occurredAt: string;
  region: string;
  type: string;
  peakCurrent: number | null;
  latitude: number;
  longitude: number;
}

export interface Species {
  specie_c: string;
  specie_s: string;
  classification: string | null;
}

/** `ipma-shellfish-restrictions`: a production zone and which species may be gathered there. */
export interface ShellfishZone {
  zoneCode: string;
  name: string;
  region: string;
  status: string;
  openSpecies: Species[];
  closedSpecies: Species[];
  latitude: number | null;
  longitude: number | null;
}

/** `dgt-caop-distritos` and `dgt-caop-municipios`: where DGT puts the middle of each, for placing what IPMA names by area. */
export interface Place {
  distrito?: string;
  dtmn?: string;
  municipio?: string;
  latitude: number;
  longitude: number;
}

export const readForecasts = (): Promise<CityForecast[]> => read("ipma-forecast-daily/records/all");
export const readWarnings = (): Promise<Warning[]> => read("ipma-warnings/records?limit=500");
export const readStations = (): Promise<StationReading[]> => read("ipma-stations-latest/records?limit=500");
export const readSea = (): Promise<SeaForecast[]> => read("ipma-sea-forecast/records/all");
export const readUv = (): Promise<UvForecast[]> => read("ipma-uv-index/records/all");
export const readEarthquakes = (): Promise<Earthquake[]> => read("ipma-earthquakes/records?limit=500");
export const readDischarges = (): Promise<Discharge[]> => read("ipma-lightning-discharges/records?limit=500");
export const readLightningHours = (): Promise<SeriesPoint[]> => read("ipma-lightning-hourly/series?limit=1000");
export const readShellfish = (): Promise<ShellfishZone[]> => read("ipma-shellfish-restrictions/records?limit=100");
export const readDistricts = (): Promise<Place[]> => read("dgt-caop-distritos/records/all");
export const readMunicipalities = (): Promise<Place[]> => read("dgt-caop-municipios/records/all");

export const readFireRisk = (): Promise<FireRisk[]> => read("ipma-fire-risk/records/all");

/** One station's last day of one measure, oldest first. */
export async function readStationDay(stationId: string, measure: string): Promise<SeriesPoint[]> {
  const points = await read<SeriesPoint>(`ipma-observations/series?seriesKey=${encodeURIComponent(`${stationId}:${measure}`)}&limit=200`);
  return points.toSorted((a, b) => a.eventTime.localeCompare(b.eventTime));
}

/** One municipality's daily values of one measure over the weeks IPMA publishes, oldest first. */
export async function readMunicipalDays(product: "ipma-municipal-temperature" | "ipma-municipal-precipitation", code: string, measure: string): Promise<SeriesPoint[]> {
  const points = await read<SeriesPoint>(`${product}/series?seriesKey=${encodeURIComponent(`${code}:${measure}`)}&limit=200`);
  return points.toSorted((a, b) => a.eventTime.localeCompare(b.eventTime));
}
