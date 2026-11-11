/**
 * What the map shows live, read in the browser from open-data.pt's public API and nowhere else.
 * open-data.pt serves each publisher's rows as they publish them; putting two products together,
 * and anything worked out from them, happens here.
 */

const API = "https://open-data.pt/api/products";

/** A reading older than this says nothing about now. */
const FRESH_MS = 3 * 3_600_000;

export interface Station {
  name: string;
  longitude: number;
  latitude: number;
  observedAt: Date;
  temperature: number | undefined;
  humidity: number | undefined;
  /** Kilometres an hour. IPMA's product carries the wind's speed and not where it blows from. */
  windSpeed: number | undefined;
}

export interface Reservoir {
  name: string;
  basin: string;
  longitude: number;
  latitude: number;
  capacityHm3: number;
  /** Cubic hectometres held at the latest reading, when SNIRH has one for this reservoir. */
  storedHm3: number | undefined;
  readAt: Date | undefined;
}

interface StationRow {
  stationName: string;
  latitude: number;
  longitude: number;
  observationTime: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
}

interface ReservoirRow {
  station: string;
  name: string;
  basin: string;
  latitude: number;
  longitude: number;
  capacityHm3: number | null;
}

interface SeriesPoint {
  seriesKey: string;
  eventTime: string;
  value: number;
  unit: string;
}

async function rows<Row>(path: string): Promise<Row[]> {
  const answer = await fetch(`${API}/${path}`);
  if (!answer.ok) throw new Error(`${path}: ${answer.status}`);
  // SAFETY: every list open-data.pt answers is `{ data: [...] }`, and each caller names the product whose rows it reads.
  return ((await answer.json()) as { data: Row[] }).data;
}

/** IPMA's stations with what each last measured, less the ones that have gone quiet. */
export async function readStations(now: Date): Promise<Station[]> {
  const latest = await rows<StationRow>("ipma-stations-latest/records/all");
  return latest
    .map((row) => ({
      name: row.stationName,
      longitude: row.longitude,
      latitude: row.latitude,
      observedAt: new Date(row.observationTime),
      temperature: row.temperature ?? undefined,
      humidity: row.humidity ?? undefined,
      windSpeed: row.windSpeed ?? undefined,
    }))
    .filter((station) => now.getTime() - station.observedAt.getTime() < FRESH_MS);
}

/** APA's reservoirs (InfoÁgua says what each can hold) with the volume SNIRH last read in each. */
export async function readReservoirs(): Promise<Reservoir[]> {
  const [reservoirs, storage] = await Promise.all([rows<ReservoirRow>("infoagua-reservoirs/records/all"), rows<SeriesPoint>("snirh-reservoir-storage/series?limit=1000")]);
  const latest = new Map<string, SeriesPoint>();
  for (const point of storage) {
    const held = latest.get(point.seriesKey);
    if (point.unit === "dam3" && (held === undefined || point.eventTime > held.eventTime)) latest.set(point.seriesKey, point);
  }
  return reservoirs.flatMap((row) => {
    if (row.capacityHm3 === null || row.capacityHm3 <= 0) return [];
    const reading = latest.get(row.station);
    return [
      {
        name: row.name,
        basin: row.basin,
        longitude: row.longitude,
        latitude: row.latitude,
        capacityHm3: row.capacityHm3,
        // A thousand cubic decametres make a cubic hectometre.
        storedHm3: reading === undefined ? undefined : reading.value / 1000,
        readAt: reading === undefined ? undefined : new Date(reading.eventTime),
      },
    ];
  });
}
