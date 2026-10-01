import {
  GatekeeperError,
  field,
  fixedOrigin,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  readBoundedResponse,
  retryAfterSeconds,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonObject,
  type JsonValue,
  type RecordProductBuild,
  type SeriesPoint,
  type SeriesProductBuild,
  type SourceBody,
  type SourceFetch,
  type TransformContext,
  type TransformResult,
} from "#/index";
import { readPointLayer } from "./shapefile";

/**
 * IPMA's dataservices site, where the EUMETSAT LSA SAF products IPMA makes are
 * published as files: among them FRP-PIXEL, the list of fire pixels Meteosat's
 * SEVIRI imager detects in every 15-minute scan of its whole disk, as a point
 * shapefile in Web Mercator with each pixel's fire radiative power in MW.
 */
export const IPMA_MF2_ORIGIN = "https://mf2.ipma.pt";

const SCAN_MS = 15 * 60_000;
/** A scan's list is written about 21 minutes after the scan starts; from 25 minutes on it is there to be read. */
const PUBLICATION_LAG_MS = 25 * 60_000;
/** A scan still missing two hours after it was due is a gap in the satellite record, not a late file, and is passed over. */
const GAP_AFTER_MS = 2 * 3_600_000;
/** The most scans one collection reads: an hour of them, so a feed that fell behind catches up at four times the pace. */
const MAX_SCANS = 4;
/**
 * A feed with no cursor, or one more than a day behind, starts at the last
 * hour: the live read never walks the archive, which only ever costs IPMA two
 * requests per scan.
 */
const MAX_BEHIND_SCANS = 96;
/** A whole-disk list in the African dry season runs to a few thousand pixels, a few hundred kilobytes. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

export const IPMA_FIRE_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Reads the scans after the feed's cursor, up to the last one published, and
 * hands the transform their fire pixels in the source's own coordinates. Two
 * small static files per scan, and nothing at all when no new scan is due.
 */
export async function collectIpmaFireDetections(state: JsonObject | undefined, now: Date, mf2Origin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const origin = fixedOrigin(mf2Origin, IPMA_MF2_ORIGIN);
  const latest = Math.floor((now.getTime() - PUBLICATION_LAG_MS) / SCAN_MS) * SCAN_MS;
  const cursor = isJsonString(state?.nextScan) ? Date.parse(state.nextScan) : Number.NaN;
  const resume = Number.isFinite(cursor) && cursor % SCAN_MS === 0 && cursor >= latest - MAX_BEHIND_SCANS * SCAN_MS;
  const first = resume ? cursor : latest - (MAX_SCANS - 1) * SCAN_MS;
  if (first > latest) return { kind: "not-modified" };

  const scans: JsonObject[] = [];
  let published: string | undefined;
  let lastUrl: URL | undefined;
  let scan = first;
  while (scan <= latest && scan < first + MAX_SCANS * SCAN_MS) {
    const files = await readScan(origin, scan, fetcher);
    if (files) {
      const { points, rejected } = readPointLayer(files.shp, files.dbf, "value");
      scans.push({ scan: new Date(scan).toISOString(), pixels: points, rejected });
      published = files.lastModified ?? published;
      lastUrl = files.url;
    } else if (now.getTime() - (scan + PUBLICATION_LAG_MS) < GAP_AFTER_MS) break;
    scan += SCAN_MS;
  }
  if (scan === first) return { kind: "not-modified" };

  const body = new TextEncoder().encode(JSON.stringify({ scans }));
  if (body.byteLength > IPMA_FIRE_MAX_BYTES) throw new GatekeeperError(`IPMA fire lists exceeded ${IPMA_FIRE_MAX_BYTES} bytes`, "response-too-large");
  const fetched: SourceBody = {
    kind: "body",
    body,
    provenance: { sourceUrl: (lastUrl ? new URL(".", lastUrl) : new URL("/downloads/data/lsasaf/frp/", origin)).toString() },
    // Every scan read is read whole. A collection that only passed over gaps read nothing, and replaces nothing.
    completeness: scans.length > 0 ? "complete" : "partial",
    state: { nextScan: new Date(scan).toISOString() },
  };
  if (published) fetched.provenance.sourcePublishedAt = published;
  return fetched;
}

interface ScanFiles {
  shp: Uint8Array;
  dbf: Uint8Array;
  url: URL;
  lastModified: string | undefined;
}

/** One scan's shapefile and table, or nothing when either is not there yet. */
async function readScan(origin: string, scan: number, fetcher: typeof fetch): Promise<ScanFiles | undefined> {
  const stamp = new Date(scan).toISOString();
  const day = `${stamp.slice(0, 4)}/${stamp.slice(5, 7)}/${stamp.slice(8, 10)}`;
  const name = `LSASAF_MSG_FRP-PIXEL-ListProduct_MSG-Disk_${stamp.slice(0, 4)}${stamp.slice(5, 7)}${stamp.slice(8, 10)}${stamp.slice(11, 13)}${stamp.slice(14, 16)}`;
  const base = `/downloads/data/lsasaf/frp/${day}/${name}`;
  const shpUrl = new URL(`${base}.shp`, origin);
  const shp = await readFile(shpUrl, fetcher);
  if (!shp) return undefined;
  const dbf = await readFile(new URL(`${base}.dbf`, origin), fetcher);
  if (!dbf) return undefined;
  const lastModified = Date.parse(shp.lastModified ?? "");
  return { shp: shp.bytes, dbf: dbf.bytes, url: shpUrl, lastModified: Number.isFinite(lastModified) ? new Date(lastModified).toISOString() : undefined };
}

async function readFile(url: URL, fetcher: typeof fetch): Promise<{ bytes: Uint8Array; lastModified: string | null } | undefined> {
  const response = await fetcher(url, { headers: { Accept: "application/octet-stream" }, redirect: "manual" });
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return undefined;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new GatekeeperError(`IPMA returned HTTP ${response.status} for ${url.pathname}`, "upstream-error", retryAfterSeconds(response.headers));
  }
  return { bytes: await readBoundedResponse(response, MAX_FILE_BYTES, `IPMA ${url.pathname}`), lastModified: response.headers.get("last-modified") };
}

/* ---------- Transform ---------- */

interface Region {
  key: string;
  name: string;
  contains: (latitude: number, longitude: number) => boolean;
}

/**
 * Mainland Portugal at 1:110m (Natural Earth, public domain), longitude then
 * latitude: coarse, as a Meteosat pixel over Portugal is about 4 by 5 km, but
 * it keeps the fires of Galicia, Castile and Extremadura out.
 */
const MAINLAND_OUTLINE: ReadonlyArray<readonly [number, number]> = [
  [-9.03, 41.88],
  [-8.67, 42.13],
  [-8.26, 42.28],
  [-8.01, 41.79],
  [-7.42, 41.79],
  [-7.25, 41.92],
  [-6.67, 41.88],
  [-6.39, 41.38],
  [-6.85, 41.11],
  [-6.86, 40.33],
  [-7.03, 40.18],
  [-7.07, 39.71],
  [-7.5, 39.63],
  [-7.1, 39.03],
  [-7.37, 38.37],
  [-7.03, 38.08],
  [-7.17, 37.8],
  [-7.54, 37.43],
  [-7.45, 37.1],
  [-7.86, 36.84],
  [-8.38, 36.98],
  [-8.9, 36.87],
  [-8.75, 37.65],
  [-8.84, 38.27],
  [-9.29, 38.36],
  [-9.53, 38.74],
  [-9.45, 39.39],
  [-9.05, 39.76],
  [-8.98, 40.16],
  [-8.77, 40.76],
  [-8.79, 41.18],
  [-8.99, 41.54],
];

/** The island groups sit alone in the ocean, so a box around each holds nothing else. */
const REGIONS: readonly Region[] = [
  { key: "mainland", name: "Mainland Portugal", contains: (latitude, longitude) => insideOutline(longitude, latitude) },
  { key: "madeira", name: "Madeira", contains: (latitude, longitude) => longitude >= -17.4 && longitude <= -15.7 && latitude >= 32.3 && latitude <= 33.3 },
  { key: "azores", name: "Azores", contains: (latitude, longitude) => longitude >= -31.5 && longitude <= -24.8 && latitude >= 36.8 && latitude <= 40.1 },
];

const DETECTION_SCHEMA: CanonicalSchema = {
  fields: [
    field("detectedAt", "datetime", false),
    field("region", "category", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("fireRadiativePower", "number", false, "MW", "Fire radiative power"),
  ],
};

const ACTIVITY_SCHEMA: CanonicalSchema = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};

const EARTH_RADIUS_M = 6_378_137;
const MERCATOR_LIMIT_M = Math.PI * EARTH_RADIUS_M;

/** The fire lists' pixels, kept where they fall on Portugal, as detections and as each region's activity per scan. */
export class IpmaFireTransformer {
  readonly id = "ipma-lsasaf-frp";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): TransformResult {
    let document: JsonValue;
    try {
      document = parseJsonBytes(bytes);
    } catch {
      throw new GatekeeperError("IPMA fire lists must be valid JSON", "invalid-response");
    }
    if (!isJsonObject(document) || !isJsonArray(document.scans)) throw new GatekeeperError("IPMA fire lists must hold scans", "invalid-response");

    const records: CanonicalRecord[] = [];
    const points: SeriesPoint[] = [];
    let rejected = 0;
    let watermark: string | undefined;
    for (const entry of document.scans) {
      if (!isJsonObject(entry) || !isJsonString(entry.scan) || !isJsonArray(entry.pixels) || !isJsonNumber(entry.rejected))
        throw new GatekeeperError("IPMA fire scan is malformed", "invalid-response");
      const scan = entry.scan;
      if (Number.isNaN(Date.parse(scan)) || new Date(scan).toISOString() !== scan) throw new GatekeeperError("IPMA fire scan time is invalid", "invalid-response");
      rejected += entry.rejected;
      if (!watermark || scan > watermark) watermark = scan;
      const totals = new Map(REGIONS.map((region) => [region.key, { power: 0, pixels: 0 }]));
      const seen = new Set<string>();
      for (const value of entry.pixels) {
        const pixel = pixelOf(value);
        if (!pixel) {
          rejected += 1;
          continue;
        }
        const region = REGIONS.find((candidate) => candidate.contains(pixel.latitude, pixel.longitude));
        const entityKey = `${scan}|${pixel.latitude.toFixed(4)}|${pixel.longitude.toFixed(4)}`;
        if (!region || seen.has(entityKey)) continue;
        seen.add(entityKey);
        records.push({
          entityKey,
          eventTime: scan,
          payload: { detectedAt: scan, region: region.name, latitude: pixel.latitude, longitude: pixel.longitude, fireRadiativePower: pixel.power },
        });
        const total = totals.get(region.key);
        if (total) {
          total.power += pixel.power;
          total.pixels += 1;
        }
      }
      for (const region of REGIONS) {
        const total = totals.get(region.key) ?? { power: 0, pixels: 0 };
        const dimensions = { region: region.name };
        points.push(
          {
            seriesKey: `${region.key}:fire-radiative-power`,
            eventTime: scan,
            value: round(total.power, 1),
            unit: "MW",
            dimensions: { ...dimensions, measure: "Total fire radiative power" },
          },
          { seriesKey: `${region.key}:fire-pixels`, eventTime: scan, value: total.pixels, unit: "pixels", dimensions: { ...dimensions, measure: "Fire pixels" } },
        );
      }
    }

    const detections: RecordProductBuild = {
      productKey: "detections",
      slug: "ipma-satellite-fire-detections",
      title: context.feed.title,
      description: context.feed.description,
      role: "event-log",
      kind: "record",
      schema: DETECTION_SCHEMA,
      // What is served is the scans the last collection read; every detection stays in history.
      updateMode: "source-window",
      completeness: "complete",
      records,
    };
    const activity: SeriesProductBuild = {
      productKey: "activity",
      slug: "ipma-satellite-fire-activity",
      title: "Meteosat fire activity in Portugal",
      description:
        "For every 15-minute Meteosat scan, the number of fire pixels detected over mainland Portugal, Madeira and the Azores and their total fire radiative power, zero when none was seen.",
      role: "time-series",
      kind: "series",
      schema: ACTIVITY_SCHEMA,
      updateMode: "delta",
      completeness: "complete",
      points,
    };
    if (watermark) {
      detections.watermark = watermark;
      activity.watermark = watermark;
    }
    return {
      transformer: { id: this.id, version: this.version },
      products: [detections, activity],
      quality: { acceptedRecords: records.length + points.length, rejectedRecords: rejected },
    };
  }
}

/** A pixel's position in degrees from Web Mercator metres, and its fire radiative power. */
function pixelOf(value: JsonValue): { latitude: number; longitude: number; power: number } | undefined {
  if (!isJsonArray(value) || value.length !== 3) return undefined;
  const [x, y, power] = value;
  if (!isJsonNumber(x) || !isJsonNumber(y) || !isJsonNumber(power)) return undefined;
  if (Math.abs(x) > MERCATOR_LIMIT_M || Math.abs(y) > MERCATOR_LIMIT_M || power < 0) return undefined;
  return {
    latitude: round(((2 * Math.atan(Math.exp(y / EARTH_RADIUS_M)) - Math.PI / 2) * 180) / Math.PI, 4),
    longitude: round(((x / EARTH_RADIUS_M) * 180) / Math.PI, 4),
    power,
  };
}

/** Ray casting: whether a point falls inside the mainland outline. */
function insideOutline(longitude: number, latitude: number): boolean {
  let inside = false;
  for (let index = 0, previous = MAINLAND_OUTLINE.length - 1; index < MAINLAND_OUTLINE.length; previous = index, index += 1) {
    const [x1, y1] = MAINLAND_OUTLINE[index]!;
    const [x2, y2] = MAINLAND_OUTLINE[previous]!;
    if (y1 > latitude !== y2 > latitude && longitude < ((x2 - x1) * (latitude - y1)) / (y2 - y1) + x1) inside = !inside;
  }
  return inside;
}

function round(value: number, digits: number): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}
