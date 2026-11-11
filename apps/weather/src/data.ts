/**
 * What the map shows live, read in the browser from open-data.pt's public API and nowhere else.
 * open-data.pt serves each publisher's rows as they publish them; putting two products together,
 * and anything worked out from them, happens here.
 */

/** open-data.pt, or a kernel run with `pnpm dev` when the build is given `VITE_OPEN_DATA_API`. */
const API = `${import.meta.env["VITE_OPEN_DATA_API"] ?? "https://open-data.pt"}/api/products`;

/** A reading older than this says nothing about now. */
const FRESH_MS = 3 * 3_600_000;

export interface Station {
  name: string;
  longitude: number;
  latitude: number;
  observedAt: Date;
  temperature: number | undefined;
  humidity: number | undefined;
  /** Kilometres an hour. */
  windSpeed: number | undefined;
  /** Degrees clockwise from north the wind blows from, when the product says. */
  windFrom: number | undefined;
  /** Millimetres in the hour. */
  precipitation: number | undefined;
  /** Kilojoules of sunlight on a square metre in the hour, when the product says. */
  radiation: number | undefined;
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

/** The eight compass points IPMA names a wind by, in degrees clockwise from north. */
const COMPASS = new Map(["N", "NE", "E", "SE", "S", "SW", "W", "NW"].map((name, index) => [name, index * 45]));

interface StationRow {
  stationName: string;
  latitude: number;
  longitude: number;
  observationTime: string;
  temperature: number | null;
  humidity: number | null;
  windSpeed: number | null;
  windDirection?: string | null;
  precipitation: number | null;
  radiation?: number | null;
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
      windFrom: COMPASS.get(row.windDirection ?? ""),
      precipitation: row.precipitation ?? undefined,
      radiation: row.radiation ?? undefined,
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

/** Something that is happening at a place: an incident, a strike, a tremor, an alert. */
export interface Happening {
  longitude: number;
  latitude: number;
  at: Date | undefined;
  /** What the pointer is told, a line each: the first is the name. */
  label: string;
  /** How much it should stand out among its kind, 0 to 1. */
  weight: number;
  colour: number;
}

const DAY_MS = 86_400_000;
const WHEN = new Intl.DateTimeFormat("pt-PT", { timeZone: "Europe/Lisbon", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const COUNT = new Intl.NumberFormat("pt-PT", { maximumFractionDigits: 1 });

interface OccurrenceRow {
  status: string;
  startedAt: string;
  nature: string;
  classification: string;
  municipality: string;
  locality: string | null;
  personnel: number | null;
  groundResources: number | null;
  airResources: number | null;
  latitude: number | null;
  longitude: number | null;
}

export interface Occurrences {
  happenings: Happening[];
  personnel: number;
  fires: number;
}

/** What civil protection (ANEPC) is attending now. Fires burn red; everything else is amber. */
export async function readOccurrences(): Promise<Occurrences> {
  const open = await rows<OccurrenceRow>("anepc-active-occurrences/records?limit=500");
  let personnel = 0;
  let fires = 0;
  const happenings = open.flatMap((row): Happening[] => {
    if (row.latitude === null || row.longitude === null) return [];
    const fire = /inc[eê]ndio/iu.test(`${row.classification} ${row.nature}`);
    personnel += row.personnel ?? 0;
    fires += fire ? 1 : 0;
    const means = [`${row.personnel ?? 0} operacionais`, `${row.groundResources ?? 0} meios terrestres`, ...(row.airResources ? [`${row.airResources} meios aéreos`] : [])].join(
      " · ",
    );
    return [
      {
        longitude: row.longitude,
        latitude: row.latitude,
        at: new Date(row.startedAt),
        label: `${row.nature}\n${row.locality ?? row.municipality}, ${row.municipality}\n${row.status} · ${means}\nANEPC, desde ${WHEN.format(new Date(row.startedAt))}`,
        weight: Math.min(1, (row.personnel ?? 0) / 60),
        colour: fire ? 0xd8342a : 0x1d1d1b,
      },
    ];
  });
  return { happenings, personnel, fires };
}

/** Lightning IPMA located in the last day; the newest strikes stand out. */
export async function readLightning(now: Date): Promise<Happening[]> {
  const strikes = await rows<{ occurredAt: string; type: string; peakCurrent: number | null; latitude: number; longitude: number }>("ipma-lightning-discharges/records?limit=500");
  return strikes.flatMap((row): Happening[] => {
    const age = now.getTime() - Date.parse(row.occurredAt);
    if (age > DAY_MS) return [];
    const kind = row.type === "in-cloud" ? "dentro da nuvem" : "nuvem-solo";
    return [
      {
        longitude: row.longitude,
        latitude: row.latitude,
        at: new Date(row.occurredAt),
        label: `Descarga elétrica\n${kind}${row.peakCurrent === null ? "" : ` · ${COUNT.format(Math.abs(row.peakCurrent))} kA`}\nIPMA, ${WHEN.format(new Date(row.occurredAt))}`,
        weight: 1 - age / DAY_MS,
        colour: 0x7b4bb3,
      },
    ];
  });
}

/** The earthquakes IPMA recorded in the last week. */
export async function readEarthquakes(now: Date): Promise<Happening[]> {
  const quakes = await rows<{ time: string; latitude: number; longitude: number; magnitude: number | null; depth: number | null; region: string | null }>(
    "ipma-earthquakes/records?limit=500",
  );
  return quakes.flatMap((row): Happening[] => {
    if (now.getTime() - Date.parse(row.time) > 7 * DAY_MS || row.magnitude === null) return [];
    return [
      {
        longitude: row.longitude,
        latitude: row.latitude,
        at: new Date(row.time),
        label: `Sismo de magnitude ${COUNT.format(row.magnitude)}\n${row.region ?? ""}${row.depth === null ? "" : ` · ${COUNT.format(row.depth)} km de profundidade`}\nIPMA, ${WHEN.format(new Date(row.time))}`,
        weight: Math.min(1, row.magnitude / 5),
        colour: 0x1f7a52,
      },
    ];
  });
}

/** The river and reservoir stations InfoÁgua has above its watch level. */
export async function readFloodAlerts(): Promise<Happening[]> {
  const stations = await rows<{
    name: string;
    river: string | null;
    basin: string | null;
    latitude: number | null;
    longitude: number | null;
    watchedParameter: string | null;
    alertLevel: number | null;
    alert: string | null;
    alertColor: string | null;
  }>("infoagua-flood-alerts/records/all");
  return stations.flatMap((row): Happening[] => {
    if (row.latitude === null || row.longitude === null || row.alertLevel === null || row.alertLevel < 2) return [];
    return [
      {
        longitude: row.longitude,
        latitude: row.latitude,
        at: undefined,
        label: `Alerta de cheia em ${row.name}\n${row.river ?? ""} · bacia do ${row.basin ?? ""}\nnível ${row.alertLevel} · ${row.watchedParameter ?? ""}\nAPA, InfoÁgua`,
        weight: Math.min(1, row.alertLevel / 4),
        colour: 0x1f6aa8,
      },
    ];
  });
}

/** Heat the satellites saw in the last day: NASA's FIRMS passes and EUMETSAT's geostationary watch. */
export async function readHotspots(now: Date): Promise<Happening[]> {
  const [firms, mtg] = await Promise.all([
    rows<{ latitude: number; longitude: number; acquiredAt: string; satellite: string | null; fireRadiativePower: number | null }>(
      "nasa-firms-mainland-thermal-anomalies/records?limit=500",
    ),
    rows<{ latitude: number; longitude: number; detectedAt: string; certainty: string | null }>("eumetsat-mtg-active-fires/records?limit=500"),
  ]);
  const recent = (time: string): boolean => now.getTime() - Date.parse(time) < DAY_MS;
  return [
    ...firms
      .filter((row) => recent(row.acquiredAt))
      .map((row) => ({
        longitude: row.longitude,
        latitude: row.latitude,
        at: new Date(row.acquiredAt),
        label: `Foco de calor\n${row.fireRadiativePower === null ? "" : `${COUNT.format(row.fireRadiativePower)} MW · `}${row.satellite ?? "satélite"}\nNASA FIRMS, ${WHEN.format(new Date(row.acquiredAt))}`,
        weight: Math.min(1, (row.fireRadiativePower ?? 10) / 100),
        colour: 0xe8590c,
      })),
    ...mtg
      .filter((row) => recent(row.detectedAt))
      .map((row) => ({
        longitude: row.longitude,
        latitude: row.latitude,
        at: new Date(row.detectedAt),
        label: `Fogo ativo visto do espaço\n${row.certainty ?? ""}\nEUMETSAT, ${WHEN.format(new Date(row.detectedAt))}`,
        weight: 0.6,
        colour: 0xe8590c,
      })),
  ];
}

/** IPMA's warning levels above green, mildest first, each with its colour and its name. */
const WARNING_LEVELS = new Map([
  ["yellow", { colour: 0xf2c200, name: "amarelo" }],
  ["orange", { colour: 0xf07f13, name: "laranja" }],
  ["red", { colour: 0xd8342a, name: "vermelho" }],
]);

/**
 * IPMA's warnings in force, each district's gathered where DGT puts the middle of that district.
 * IPMA names a warning's area and DGT names its districts; where the two names agree the warning has a place.
 */
export async function readWarnings(now: Date): Promise<Happening[]> {
  const [warnings, districts] = await Promise.all([
    rows<{ area: string; type: string; level: string; startTime: string; endTime: string }>("ipma-warnings/records?limit=500"),
    rows<{ distrito: string; latitude: number; longitude: number }>("dgt-caop-distritos/records/all"),
  ]);
  const middles = new Map(districts.map((district) => [district.distrito, district]));
  const inForce = new Map<string, { type: string; level: string; endTime: string }[]>();
  for (const warning of warnings) {
    if (!WARNING_LEVELS.has(warning.level) || Date.parse(warning.endTime) < now.getTime() || Date.parse(warning.startTime) > now.getTime() + DAY_MS) continue;
    inForce.set(warning.area, [...(inForce.get(warning.area) ?? []), warning]);
  }
  const order = [...WARNING_LEVELS.keys()];
  return [...inForce].flatMap(([area, list]): Happening[] => {
    const middle = middles.get(area);
    if (middle === undefined) return [];
    const worst = list.toSorted((a, b) => order.indexOf(b.level) - order.indexOf(a.level))[0];
    if (worst === undefined) return [];
    const lines = list.map((warning) => `${warning.type}: ${WARNING_LEVELS.get(warning.level)?.name ?? warning.level}, até ${WHEN.format(new Date(warning.endTime))}`);
    return [
      {
        longitude: middle.longitude,
        latitude: middle.latitude,
        at: undefined,
        label: `Avisos em ${area}\n${lines.join("\n")}\nIPMA`,
        weight: (order.indexOf(worst.level) + 1) / 3,
        colour: WARNING_LEVELS.get(worst.level)?.colour ?? 0xffd84a,
      },
    ];
  });
}
