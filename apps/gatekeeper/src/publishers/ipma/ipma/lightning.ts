import {
  GatekeeperError,
  field,
  fixedOrigin,
  isJsonArray,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  readBoundedResponse,
  responseValidator,
  retryAfterSeconds,
  streamJsonArray,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonValue,
  type NormalizedRow,
  type ProductDeclaration,
  type SeriesPoint,
  type SourceBody,
  type SourceFetch,
  type SourceValidator,
  type StreamingTransform,
  type TransformContext,
} from "#/index";
import { PORTUGAL_REGIONS, portugalRegion } from "#/portugal";

/**
 * IPMA's website. Its lightning page carries, in its own script, every
 * discharge IPMA's detection network located in the last 24 hours over
 * mainland Portugal, Madeira, the Azores and the sea and land around them,
 * refreshed in 10-minute steps.
 */
export const IPMA_WEB_ORIGIN = "https://www.ipma.pt";
export const IPMA_LIGHTNING_PAGE = "/pt/otempo/obs.dea/";

/** A stormy day over the whole area runs to some tens of thousands of discharges, a few hundred bytes each. */
export const IPMA_LIGHTNING_MAX_BYTES = 32 * 1024 * 1024;

const HOUR_MS = 3_600_000;
/** The page shows the last 24 hours; an hour is counted only when it lies wholly inside the last 23, clear of the window's edge. */
const COUNTED_HOURS = 23;

/**
 * Reads the lightning page and hands the transform the discharges it embeds.
 * One request, answered from IPMA's own cache, and none of its body when it
 * has not changed since the last read.
 */
export async function collectIpmaLightning(checkpoint: SourceValidator | undefined, webOrigin: string, fetcher: typeof fetch): Promise<SourceFetch> {
  const url = new URL(IPMA_LIGHTNING_PAGE, fixedOrigin(webOrigin, IPMA_WEB_ORIGIN));
  const headers = new Headers({ Accept: "text/html" });
  if (checkpoint?.lastModified) headers.set("If-Modified-Since", checkpoint.lastModified);
  const response = await fetcher(url, { headers, redirect: "manual" });
  if (response.status === 304) {
    if (!headers.has("If-Modified-Since")) throw new GatekeeperError("IPMA returned unsolicited not-modified", "invalid-response");
    const validator = responseValidator(response.headers);
    return validator ? { kind: "not-modified", validator } : { kind: "not-modified" };
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new GatekeeperError(`IPMA returned HTTP ${response.status} for its lightning page`, "upstream-error", retryAfterSeconds(response.headers));
  }
  const page = new TextDecoder().decode(await readBoundedResponse(response, IPMA_LIGHTNING_MAX_BYTES, "IPMA lightning page"));
  // The map's script declares the discharges as one object literal, which is JSON, followed by the layer that draws it.
  const embedded = /\bvar data = (\{[\s\S]*?\});\s*\n\s*dea = /u.exec(page)?.[1];
  if (!embedded) throw new GatekeeperError("IPMA's lightning page no longer carries its discharges where expected", "invalid-response");
  const fetched: SourceBody = {
    kind: "body",
    body: new TextEncoder().encode(embedded),
    provenance: { sourceUrl: url.toString() },
    // The page holds the network's whole 24-hour window over its area.
    completeness: "complete",
  };
  const lastModified = Date.parse(response.headers.get("last-modified") ?? "");
  if (Number.isFinite(lastModified)) fetched.provenance.sourcePublishedAt = new Date(lastModified).toISOString();
  const validator = responseValidator(response.headers);
  if (validator) fetched.validator = validator;
  else fetched.state = {};
  return fetched;
}

const DISCHARGE_SCHEMA: CanonicalSchema = {
  fields: [
    field("occurredAt", "datetime", false),
    field("region", "category", false),
    field("type", "category", false),
    field("peakCurrent", "number", false, "kA", "Peak current"),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
  ],
};

const COUNT_SCHEMA: CanonicalSchema = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};

type DischargeType = "cloud-to-ground" | "in-cloud";

const TYPE_NAMES = { "cloud-to-ground": "Cloud-to-ground discharges", "in-cloud": "In-cloud discharges" } as const satisfies Record<DischargeType, string>;

/** The page's discharges, kept where they fall on Portugal, and each region's count per hour and type. */
export class IpmaLightningTransformer {
  readonly id = "ipma-lightning";
  readonly version = "1";

  transform(body: ReadableStream<Uint8Array>, context: TransformContext): StreamingTransform {
    const document = streamJsonArray(body, ["features"], { maxElementBytes: 16 * 1024 });
    const counts = new Map<string, number>();
    const seen = new Set<string>();
    let accepted = 0;
    let rejected = 0;
    let watermark: string | undefined;

    async function* rows(): AsyncGenerator<NormalizedRow> {
      for await (const feature of document.elements) {
        const discharge = dischargeOf(feature);
        if (!discharge) {
          rejected += 1;
          continue;
        }
        const region = portugalRegion(discharge.latitude, discharge.longitude);
        if (!region || seen.has(discharge.id)) continue;
        seen.add(discharge.id);
        accepted += 1;
        const hour = new Date(Math.floor(discharge.time / HOUR_MS) * HOUR_MS).toISOString();
        const key = `${region.key}|${discharge.type}|${hour}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
        const occurredAt = new Date(discharge.time).toISOString();
        const record: CanonicalRecord = {
          entityKey: discharge.id,
          eventTime: occurredAt,
          payload: {
            occurredAt,
            region: region.name,
            type: discharge.type,
            peakCurrent: discharge.peakCurrent,
            latitude: discharge.latitude,
            longitude: discharge.longitude,
          },
        };
        yield { productKey: "discharges", record };
      }
      const envelope = document.envelope();
      if (envelope.type !== "FeatureCollection") throw new GatekeeperError("IPMA lightning data must be a FeatureCollection", "invalid-response");
      const updated = isJsonString(envelope.update_date) ? utcInstant(envelope.update_date) : undefined;
      if (updated === undefined) return;
      watermark = new Date(updated).toISOString();
      // Every whole hour inside the window, zero where the network located nothing.
      const first = Math.ceil((updated - COUNTED_HOURS * HOUR_MS) / HOUR_MS) * HOUR_MS;
      for (let start = first; start + HOUR_MS <= updated; start += HOUR_MS) {
        const hour = new Date(start).toISOString();
        for (const region of PORTUGAL_REGIONS) {
          for (const type of ["cloud-to-ground", "in-cloud"] as const) {
            const point: SeriesPoint = {
              seriesKey: `${region.key}:${type}`,
              eventTime: hour,
              value: counts.get(`${region.key}|${type}|${hour}`) ?? 0,
              unit: "discharges",
              dimensions: { region: region.name, measure: TYPE_NAMES[type] },
            };
            yield { productKey: "hourly", point };
          }
        }
      }
    }

    const products: ProductDeclaration[] = [
      {
        productKey: "discharges",
        slug: "ipma-lightning-discharges",
        title: context.feed.title,
        description: context.feed.description,
        role: "event-log",
        kind: "record",
        schema: DISCHARGE_SCHEMA,
        // The page's last 24 hours replace what is served; every discharge stays in history.
        updateMode: "source-window",
        completeness: "complete",
      },
      {
        productKey: "hourly",
        slug: "ipma-lightning-hourly",
        title: "IPMA lightning per hour",
        description:
          "The number of cloud-to-ground and in-cloud discharges IPMA's network located over mainland Portugal, Madeira and the Azores in each hour, zero when there were none.",
        role: "time-series",
        kind: "series",
        schema: COUNT_SCHEMA,
        updateMode: "delta",
        completeness: "complete",
      },
    ];
    return {
      products,
      rows: rows(),
      finish: () => {
        const quality = { acceptedRecords: accepted, rejectedRecords: rejected };
        const stamped = watermark;
        return stamped ? { quality, products: products.map((product) => ({ productKey: product.productKey, watermark: stamped })) } : { quality };
      },
    };
  }
}

/** One discharge as the page states it: IPMA's own ID, its time, kind, peak current and position. */
interface Discharge {
  id: string;
  time: number;
  type: DischargeType;
  peakCurrent: number;
  latitude: number;
  longitude: number;
}

function dischargeOf(feature: JsonValue): Discharge | undefined {
  if (!isJsonObject(feature) || !isJsonNumber(feature.id) || !Number.isSafeInteger(feature.id)) return undefined;
  const { properties, geometry } = feature;
  if (!isJsonObject(properties) || !isJsonObject(geometry) || geometry.type !== "Point" || !isJsonArray(geometry.coordinates)) return undefined;
  const [longitude, latitude] = geometry.coordinates;
  if (!isJsonNumber(longitude) || !isJsonNumber(latitude) || Math.abs(longitude) > 180 || Math.abs(latitude) > 90) return undefined;
  if (!isJsonString(properties.time) || !isJsonBoolean(properties.icloud) || !isJsonNumber(properties.amplitude)) return undefined;
  const time = Date.parse(properties.time);
  if (!Number.isFinite(time)) return undefined;
  return { id: String(feature.id), time, type: properties.icloud ? "in-cloud" : "cloud-to-ground", peakCurrent: properties.amplitude, latitude, longitude };
}

/** The page's update time, which it writes in UTC without saying so. */
function utcInstant(value: string): number | undefined {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/u.test(value)) return undefined;
  const instant = Date.parse(`${value}Z`);
  return Number.isFinite(instant) ? instant : undefined;
}
