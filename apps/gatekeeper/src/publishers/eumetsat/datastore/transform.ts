import {
  GatekeeperError,
  field,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonValue,
  type RecordProductBuild,
  type SeriesPoint,
  type SeriesProductBuild,
  type TransformContext,
  type TransformResult,
} from "#/index";
import { PORTUGAL_REGIONS, portugalRegion } from "#/portugal";

const FIRE_SCHEMA: CanonicalSchema = {
  fields: [
    field("detectedAt", "datetime", false),
    field("region", "category", false),
    field("certainty", "category", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("pixelRadius", "number", false, "km", "Pixel radius"),
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

type Certainty = "likely" | "possible";

const CERTAINTY_NAMES = { likely: "Likely fires", possible: "Possible fires" } as const satisfies Record<Certainty, string>;

/** The scans' fires, kept where they fall on Portugal, as detections and as each region's count per scan and certainty. */
export class ActiveFiresTransformer {
  readonly id = "eumetsat-mtg-active-fires";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): TransformResult {
    let document: JsonValue;
    try {
      document = parseJsonBytes(bytes);
    } catch {
      throw new GatekeeperError("Active fire scans must be valid JSON", "invalid-response");
    }
    if (!isJsonObject(document) || !isJsonArray(document.scans) || !isJsonNumber(document.rejected))
      throw new GatekeeperError("Active fire scans are malformed", "invalid-response");

    const records: CanonicalRecord[] = [];
    const points: SeriesPoint[] = [];
    let rejected = document.rejected;
    let watermark: string | undefined;
    for (const scan of document.scans) {
      if (!isJsonObject(scan) || !isJsonString(scan.start) || !isJsonArray(scan.fires)) throw new GatekeeperError("Active fire scan is malformed", "invalid-response");
      const start = scan.start;
      if (Number.isNaN(Date.parse(start)) || new Date(start).toISOString() !== start) throw new GatekeeperError("Active fire scan time is invalid", "invalid-response");
      if (!watermark || start > watermark) watermark = start;
      const counts = new Map<string, number>();
      const seen = new Set<string>();
      for (const value of scan.fires) {
        const fire = fireOf(value);
        if (!fire) {
          rejected += 1;
          continue;
        }
        const region = portugalRegion(fire.latitude, fire.longitude);
        const entityKey = `${start}|${fire.latitude.toFixed(3)}|${fire.longitude.toFixed(3)}`;
        if (!region || seen.has(entityKey)) continue;
        seen.add(entityKey);
        records.push({
          entityKey,
          eventTime: start,
          payload: {
            detectedAt: start,
            region: region.name,
            certainty: fire.certainty,
            latitude: fire.latitude,
            longitude: fire.longitude,
            pixelRadius: fire.radius,
          },
        });
        const key = `${region.key}|${fire.certainty}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      for (const region of PORTUGAL_REGIONS)
        for (const certainty of ["likely", "possible"] as const)
          points.push({
            seriesKey: `${region.key}:${certainty}-fires`,
            eventTime: start,
            value: counts.get(`${region.key}|${certainty}`) ?? 0,
            unit: "fires",
            dimensions: { region: region.name, measure: CERTAINTY_NAMES[certainty] },
          });
    }

    const fires: RecordProductBuild = {
      productKey: "fires",
      slug: "eumetsat-mtg-active-fires",
      title: context.feed.title,
      description: context.feed.description,
      role: "event-log",
      kind: "record",
      schema: FIRE_SCHEMA,
      // What is served is the scans the last collection read; every fire stays in history.
      updateMode: "source-window",
      completeness: "complete",
      records,
    };
    const activity: SeriesProductBuild = {
      productKey: "activity",
      slug: "eumetsat-mtg-active-fire-counts",
      title: "Meteosat active fires in Portugal",
      description:
        "For every 10-minute Meteosat Third Generation scan, the number of likely and of possible fires detected over mainland Portugal, Madeira and the Azores, zero when none was seen.",
      role: "time-series",
      kind: "series",
      schema: ACTIVITY_SCHEMA,
      updateMode: "delta",
      completeness: "complete",
      points,
    };
    if (watermark) {
      fires.watermark = watermark;
      activity.watermark = watermark;
    }
    return {
      transformer: { id: this.id, version: this.version },
      products: [fires, activity],
      quality: { acceptedRecords: records.length + points.length, rejectedRecords: rejected },
    };
  }
}

/** One fire as the fetch hands it: `[latitude, longitude, radius in km, certainty]`. */
function fireOf(value: JsonValue): { latitude: number; longitude: number; radius: number; certainty: Certainty } | undefined {
  if (!isJsonArray(value) || value.length !== 4) return undefined;
  const [latitude, longitude, radius, certainty] = value;
  if (!isJsonNumber(latitude) || !isJsonNumber(longitude) || !isJsonNumber(radius)) return undefined;
  if (certainty !== "likely" && certainty !== "possible") return undefined;
  if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180 || radius < 0) return undefined;
  return { latitude, longitude, radius, certainty };
}
