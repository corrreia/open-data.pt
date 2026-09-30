import {
  GatekeeperError,
  field,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type CanonicalField,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonObject,
  type JsonValue,
  type ProductBuild,
  type SeriesPoint,
  type TransformContext,
  type Transformer,
  type UnstampedResult,
} from "#/index";
import { SNIRH_STATIONS } from "#/publishers/apa/snirh/stations";
import { validateInfoaguaFeedConfig } from "./infoagua";

function badge(id: string, colorField: string, label: string): CanonicalField {
  return { id, name: id, type: "category", nullable: true, display: { label, badge: { colorField } } };
}

const FLOOD_SCHEMA: CanonicalSchema = {
  fields: [
    field("station", "identifier", false, undefined, "SNIRH station"),
    field("name", "string", true),
    field("type", "category", true),
    field("river", "string", true),
    field("basin", "category", true),
    field("latitude", "latitude", true),
    field("longitude", "longitude", true),
    field("watchedParameter", "category", true, undefined, "Watched parameter"),
    field("alertLevel", "number", true, undefined, "Alert level"),
    badge("alert", "alertColor", "Alert"),
    field("alertColor", "color", true, undefined, "Alert colour"),
  ],
};

const DROUGHT_SCHEMA: CanonicalSchema = {
  fields: [
    field("month", "date", false),
    field("basinId", "identifier", false, undefined, "Basin ID"),
    field("basin", "category", true),
    field("index", "number", true),
    field("state", "number", true),
    badge("stateName", "stateColor", "State"),
    field("stateColor", "color", true, undefined, "State colour"),
  ],
};

const RESERVOIR_SCHEMA: CanonicalSchema = {
  fields: [
    field("station", "identifier", false, undefined, "SNIRH station"),
    field("site", "identifier", false, undefined, "SNIRH site"),
    field("name", "string", true),
    field("basin", "category", true),
    field("latitude", "latitude", true),
    field("longitude", "longitude", true),
    field("capacityHm3", "number", true, "hm³", "Capacity"),
    field("usableVolumeHm3", "number", true, "hm³", "Usable volume"),
    field("fullSupplyLevelM", "number", true, "m", "Full supply level"),
    field("waterSupply", "boolean", true, undefined, "Water supply"),
    field("energy", "boolean", true),
    field("industry", "boolean", true),
    field("irrigation", "boolean", true),
    field("environmentalFlow", "boolean", true, undefined, "Environmental flow"),
    field("floodControl", "boolean", true, undefined, "Flood control"),
    field("monthlyLows", "json", false, undefined, "Lowest volume on record, by month"),
  ],
};

const SERIES_SCHEMA: CanonicalSchema = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};

/** The two series of the reservoir flows feed, by the reading each is read from. */
const FLOWS = [
  {
    reading: "reservoir-inflow",
    productKey: "inflows",
    slug: "infoagua-reservoir-inflows",
    title: "Portugal reservoir inflows",
    description: "The hourly flow into each reservoir InfoÁgua watches for floods, in cubic metres per second.",
  },
  {
    reading: "reservoir-outflow",
    productKey: "outflows",
    slug: "infoagua-reservoir-outflows",
    title: "Portugal reservoir outflows",
    description: "The hourly flow each reservoir InfoÁgua watches for floods lets out downstream, in cubic metres per second.",
  },
] as const;

export class InfoaguaTransformer implements Transformer {
  readonly id = "infoagua";
  readonly version = "2";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const config = validateInfoaguaFeedConfig(context.feed.config);
    const document = parseJsonBytes(bytes);
    if (!isJsonObject(document) || document.feed !== config.feed || !isJsonArray(document.entries))
      throw new GatekeeperError("InfoÁgua collection does not match its feed", "invalid-response");
    if (config.feed === "reservoir-flows") return flows(document.entries.filter(isJsonObject), isJsonNumber(document.unreadable) ? document.unreadable : 0);
    if (config.feed === "reservoirs") return reservoirs(document.entries, context);
    const records: CanonicalRecord[] = [];
    let rejected = 0;
    for (const entry of document.entries) {
      if (!isJsonObject(entry)) {
        rejected += 1;
        continue;
      }
      if (config.feed === "flood-alerts") {
        if (!isJsonString(entry.station)) rejected += 1;
        else records.push({ entityKey: entry.station, payload: entry });
        continue;
      }
      if (!isJsonString(entry.basinId) || !isJsonString(entry.month) || !/^\d{4}-\d{2}$/u.test(entry.month)) {
        rejected += 1;
        continue;
      }
      const month = entry.month;
      records.push({ entityKey: `${entry.basinId}:${month}`, eventTime: `${month}-01T00:00:00.000Z`, payload: { ...entry, month: `${month}-01` } });
    }
    const flood = config.feed === "flood-alerts";
    const product: ProductBuild = {
      productKey: config.feed ?? "",
      slug: context.feed.slug.replace(/-feed$/u, ""),
      title: context.feed.title,
      description: context.feed.description,
      role: flood ? "current-state" : "summary",
      kind: "record",
      schema: flood ? FLOOD_SCHEMA : DROUGHT_SCHEMA,
      records,
      // The flood page lists every watched station; the drought page shows only the latest month, and the months before it
      // are kept rather than retracted.
      updateMode: flood ? "authoritative-snapshot" : "delta",
      completeness: "complete",
    };
    const watermark = flood
      ? undefined
      : records
          .map((record) => record.eventTime ?? "")
          .sort()
          .at(-1);
    if (watermark) product.watermark = watermark;
    return { products: [product], quality: { acceptedRecords: records.length, rejectedRecords: rejected } };
  }
}

/** The reservoirs of the drought pages, keyed by SNIRH code; the list is every reservoir those pages show. */
function reservoirs(entries: readonly JsonValue[], context: TransformContext): UnstampedResult {
  const records: CanonicalRecord[] = [];
  let rejected = 0;
  for (const entry of entries) {
    if (!isJsonObject(entry) || !isJsonString(entry.station)) rejected += 1;
    else records.push({ entityKey: entry.station, payload: entry });
  }
  const product: ProductBuild = {
    productKey: "reservoirs",
    slug: context.feed.slug.replace(/-feed$/u, ""),
    title: context.feed.title,
    description: context.feed.description,
    role: "reference",
    kind: "record",
    schema: RESERVOIR_SCHEMA,
    records,
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  };
  return { products: [product], quality: { acceptedRecords: records.length, rejectedRecords: rejected } };
}

/**
 * Each reservoir's flows under the code and name SNIRH files it by, so they sit beside SNIRH's reservoir series. Times
 * are InfoÁgua's `YYYY-MM-DD HH:MM:SS` in UTC. A reservoir missing from SNIRH's table (one in Spain, or one whose SNIRH
 * name we have not seen) is left out, and logged: it was never going to be published, so it is not a rejected reading.
 */
function flows(entries: readonly JsonObject[], unreadable: number): UnstampedResult {
  let rejected = unreadable;
  const unknown = new Set<string>();
  const points = new Map<string, SeriesPoint[]>(FLOWS.map((flow) => [flow.reading, []]));
  for (const entry of entries) {
    const values = isJsonArray(entry.values) ? entry.values.filter(isJsonObject) : [];
    const identity = isJsonString(entry.site) ? SNIRH_STATIONS.get(entry.site) : undefined;
    const series = isJsonString(entry.reading) ? points.get(entry.reading) : undefined;
    if (!series) {
      rejected += values.length;
      continue;
    }
    if (!identity) {
      if (values.length > 0 && isJsonString(entry.site)) unknown.add(entry.site);
      continue;
    }
    for (const value of values) {
      if (!isJsonString(value.moment) || !isJsonNumber(value.value)) {
        rejected += 1;
        continue;
      }
      series.push({
        seriesKey: identity.code,
        eventTime: `${value.moment.replace(" ", "T")}.000Z`,
        value: value.value,
        unit: "m3/s",
        dimensions: { station: identity.code, name: identity.name },
      });
    }
  }
  if (unknown.size > 0)
    console.warn(JSON.stringify({ event: "infoagua_stations_not_in_snirh", reading: "reservoir-flows", stations: unknown.size, sites: [...unknown].slice(0, 10) }));
  const products = FLOWS.map((flow): ProductBuild => {
    const series = points.get(flow.reading) ?? [];
    const product: ProductBuild = {
      productKey: flow.productKey,
      slug: flow.slug,
      title: flow.title,
      description: flow.description,
      role: "time-series",
      kind: "series",
      schema: SERIES_SCHEMA,
      points: series,
      // InfoÁgua shows the last 48 hours; an hour that leaves them was not taken back.
      updateMode: "source-window",
      completeness: "complete",
    };
    const watermark = series
      .map((point) => point.eventTime)
      .sort()
      .at(-1);
    if (watermark) product.watermark = watermark;
    return product;
  });
  const accepted = products.reduce((sum, product) => sum + (product.kind === "series" ? product.points.length : 0), 0);
  return { products, quality: { acceptedRecords: accepted, rejectedRecords: rejected } };
}
