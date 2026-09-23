import { GatekeeperError, field, streamCsvRecords, type CanonicalRecord, type CanonicalSchema, type NormalizedRow, type StreamingTransform, type TransformContext } from "#/index";
import { FIRMS_REGIONS, validateFirmsFeedConfig } from "./firms";

const SCHEMA: CanonicalSchema = {
  fields: [
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("acquiredAt", "datetime", false),
    field("satellite", "category", false),
    field("instrument", "category", false),
    field("confidence", "category", false),
    field("dayNight", "category", false),
    field("brightness", "number", false, "K"),
    field("brightT31", "number", true, "K"),
    field("fireRadiativePower", "number", true, "MW"),
    field("scan", "number", true, "km"),
    field("track", "number", true, "km"),
    field("version", "string", true),
  ],
};

export class FirmsTransformer {
  readonly id = "nasa-firms-csv";
  readonly version = "1";

  async transform(body: ReadableStream<Uint8Array>, context: TransformContext): Promise<StreamingTransform> {
    const config = validateFirmsFeedConfig(context.feed.config);
    const parsed = streamCsvRecords(body, { maxRowBytes: 16 * 1024 });
    const header = await parsed.header;
    for (const required of ["latitude", "longitude", "acq_date", "acq_time", "satellite", "instrument", "confidence", "daynight"])
      if (!header.includes(required)) throw new GatekeeperError(`FIRMS CSV omitted ${required}`, "invalid-response");
    if (!header.includes("bright_ti4") && !header.includes("brightness")) throw new GatekeeperError("FIRMS CSV omitted brightness", "invalid-response");
    let total = 0;
    let accepted = 0;
    let watermark: string | undefined;
    const region = regionOf(config.region);

    async function* rows(): AsyncGenerator<NormalizedRow> {
      for await (const row of parsed.records) {
        total += 1;
        const record = hotspot(row, region.bbox);
        if (!record) continue;
        accepted += 1;
        if (!watermark || (record.eventTime && record.eventTime > watermark)) watermark = record.eventTime;
        yield { productKey: "hotspots", record };
      }
    }

    return {
      products: [
        {
          productKey: "hotspots",
          slug: context.feed.slug.replace(/-feed$/u, ""),
          title: context.feed.title,
          description: context.feed.description,
          role: "event-log",
          kind: "record",
          schema: SCHEMA,
          updateMode: "source-window",
          completeness: "complete",
        },
      ],
      rows: rows(),
      finish: () => {
        const summary = { quality: { acceptedRecords: accepted, rejectedRecords: total - accepted } };
        return watermark ? { ...summary, products: [{ productKey: "hotspots", watermark }] } : summary;
      },
    };
  }
}

function regionOf(value: string | undefined): (typeof FIRMS_REGIONS)[keyof typeof FIRMS_REGIONS] {
  if (value === "mainland" || value === "madeira" || value === "azores") return FIRMS_REGIONS[value];
  throw new GatekeeperError("FIRMS region was not resolved", "invalid-config");
}

function hotspot(row: Record<string, string>, bbox: string): CanonicalRecord | undefined {
  const latitude = finite(row.latitude);
  const longitude = finite(row.longitude);
  const brightness = finite(first(row.bright_ti4, row.brightness));
  const acquiredAt = acquisitionTime(row.acq_date, row.acq_time);
  const satellite = shortText(row.satellite);
  const instrument = shortText(row.instrument);
  const confidence = shortText(row.confidence);
  const dayNight = shortText(row.daynight);
  if (
    latitude === undefined ||
    longitude === undefined ||
    brightness === undefined ||
    !acquiredAt ||
    !satellite ||
    !instrument ||
    !confidence ||
    !dayNight ||
    !inside(latitude, longitude, bbox)
  )
    return undefined;
  const entityKey = `${satellite}|${instrument}|${acquiredAt}|${latitude.toFixed(5)}|${longitude.toFixed(5)}`;
  return {
    entityKey,
    eventTime: acquiredAt,
    payload: {
      latitude,
      longitude,
      acquiredAt,
      satellite,
      instrument,
      confidence,
      dayNight,
      brightness,
      brightT31: optionalFinite(first(row.bright_t31, row.bright_ti5)),
      fireRadiativePower: optionalFinite(row.frp),
      scan: optionalFinite(row.scan),
      track: optionalFinite(row.track),
      version: shortText(row.version) ?? null,
    },
  };
}

function first(left: string | undefined, right: string | undefined): string | undefined {
  return left?.trim() ? left : right;
}

function acquisitionTime(date: string | undefined, time: string | undefined): string | undefined {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/u.test(date) || !time || !/^\d{1,4}$/u.test(time)) return undefined;
  const padded = time.padStart(4, "0");
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const day = Number(date.slice(8, 10));
  const hour = Number(padded.slice(0, 2));
  const minute = Number(padded.slice(2));
  const acquiredAt = new Date(Date.UTC(year, month - 1, day, hour, minute));
  if (
    acquiredAt.getUTCFullYear() !== year ||
    acquiredAt.getUTCMonth() + 1 !== month ||
    acquiredAt.getUTCDate() !== day ||
    acquiredAt.getUTCHours() !== hour ||
    acquiredAt.getUTCMinutes() !== minute
  )
    return undefined;
  return acquiredAt.toISOString();
}

function finite(value: string | undefined): number | undefined {
  if (!value || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalFinite(value: string | undefined): number | null {
  return finite(value) ?? null;
}

function shortText(value: string | undefined): string | undefined {
  const text = value?.trim();
  return text && text.length <= 100 ? text : undefined;
}

function inside(latitude: number, longitude: number, bbox: string): boolean {
  const values = bbox.split(",").map(Number);
  const west = values[0];
  const south = values[1];
  const east = values[2];
  const north = values[3];
  return west !== undefined && south !== undefined && east !== undefined && north !== undefined && longitude >= west && longitude <= east && latitude >= south && latitude <= north;
}
