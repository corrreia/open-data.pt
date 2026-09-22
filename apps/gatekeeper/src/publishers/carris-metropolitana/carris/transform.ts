import { field, isJsonBoolean, isJsonNumber, isJsonObject, isJsonString, parseJsonBytes } from "#/index";
import type { CanonicalRecord, CanonicalSchema, JsonValue, ProductBuild, TransformContext, Transformer, UnstampedResult } from "#/index";

const LINE_SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    { ...field("shortName", "string", true), display: { badge: { colorField: "color", textColorField: "textColor" } } },
    field("longName", "string", false),
    field("color", "color", true),
    field("textColor", "color", true),
    field("municipalityIds", "json", false),
    field("routeIds", "json", false),
  ],
};

const VEHICLE_SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    field("agencyId", "category", true),
    field("lineId", "identifier", true),
    field("routeId", "identifier", true),
    field("patternId", "identifier", true),
    field("tripId", "identifier", true),
    field("stopId", "identifier", true),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("bearing", "number", true, "degree"),
    field("speed", "number", true, "unknown-source-unit"),
    field("status", "category", true),
    field("doorStatus", "category", true),
    field("eventTime", "datetime", false),
    field("propulsion", "category", true),
    field("make", "category", true),
    field("model", "category", true),
    field("owner", "category", true),
    field("licensePlate", "identifier", true),
    field("capacityTotal", "number", true, "person"),
    field("wheelchairAccessible", "boolean", true),
    field("bikesAllowed", "boolean", true),
  ],
};

const ROUTE_SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    field("lineId", "identifier", true),
    { ...field("shortName", "string", true), display: { badge: { colorField: "color", textColorField: "textColor" } } },
    field("longName", "string", false),
    field("color", "color", true),
    field("textColor", "color", true),
    field("municipalityIds", "json", false),
    field("localityIds", "json", false),
    field("patternIds", "json", false),
  ],
};

const STOP_SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    field("name", "string", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("municipalityId", "category", true),
    field("districtId", "category", true),
    field("parishId", "identifier", true),
    field("localityId", "identifier", true),
    field("wheelchairBoarding", "boolean", true),
    field("lineIds", "json", false),
    field("routeIds", "json", false),
  ],
};

const SUMMARY_SCHEMA: CanonicalSchema = {
  fields: [
    field("agencyId", "category", false),
    field("activeVehicles", "number", false, "vehicle"),
    field("vehiclesByPropulsion", "json", false),
    field("measuredAt", "datetime", false),
  ],
};

const SERIES_SCHEMA: CanonicalSchema = {
  fields: [field("seriesKey", "string", false), field("eventTime", "datetime", false), field("value", "number", false, "vehicle"), field("dimensions", "json", false)],
};

const ALERT_SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    field("title", "string", false),
    field("description", "string", true),
    field("cause", "category", true),
    field("effect", "category", true),
    field("informedEntities", "json", false),
    field("validFrom", "datetime", true),
    field("validTo", "datetime", true),
  ],
};

export class CarrisTransformer implements Transformer {
  readonly id = "carris-v2";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const value: JsonValue = parseJsonBytes(bytes);
    if (!Array.isArray(value)) throw new Error("Carris response must be an array");
    switch (context.feed.config.feed) {
      case "alerts":
        return transformAlerts(value);
      case "lines":
        return transformLines(value);
      case "routes":
        return transformRoutes(value);
      case "stops":
        return transformStops(value);
      case "vehicles":
        return transformVehicles(value, context);
      default:
        throw new Error(`Unsupported Carris feed: ${context.feed.config.feed}`);
    }
  }
}

function transformLines(values: JsonValue[]): UnstampedResult {
  const records = values.flatMap((value) => {
    if (!isJsonObject(value) || !string(value.id) || !string(value.long_name)) return [];
    return [
      {
        entityKey: value.id,
        payload: {
          id: value.id,
          shortName: nullableString(value.short_name),
          longName: value.long_name,
          color: nullableString(value.color),
          textColor: nullableString(value.text_color),
          municipalityIds: stringArray(value.municipality_ids),
          routeIds: stringArray(value.route_ids),
        },
      },
    ];
  });
  return result(values.length, records.length, [
    {
      productKey: "lines",
      slug: "carris-lines",
      title: "Carris Metropolitana lines",
      description: "The current reference catalog of Carris Metropolitana lines.",
      role: "reference",
      schema: LINE_SCHEMA,
      kind: "record",
      records,
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    },
  ]);
}

function transformRoutes(values: JsonValue[]): UnstampedResult {
  const records = values.flatMap((value) => {
    if (!isJsonObject(value) || !string(value.id) || !string(value.long_name)) return [];
    return [
      {
        entityKey: value.id,
        payload: {
          id: value.id,
          lineId: nullableString(value.line_id),
          shortName: nullableString(value.short_name),
          longName: value.long_name,
          color: nullableString(value.color),
          textColor: nullableString(value.text_color),
          municipalityIds: stringArray(value.municipality_ids),
          localityIds: stringArray(value.locality_ids),
          patternIds: stringArray(value.pattern_ids),
        },
      },
    ];
  });
  return result(values.length, records.length, [
    {
      productKey: "routes",
      slug: "carris-routes",
      title: "Carris Metropolitana routes",
      description: "Every route variant of every line, with colours and served municipalities.",
      role: "reference",
      schema: ROUTE_SCHEMA,
      kind: "record",
      records,
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    },
  ]);
}

function transformStops(values: JsonValue[]): UnstampedResult {
  const records = values.flatMap((value) => {
    if (!isJsonObject(value) || !string(value.id) || !number(value.lat) || !number(value.lon)) {
      return [];
    }
    return [
      {
        entityKey: value.id,
        payload: {
          id: value.id,
          name: nullableString(value.long_name) ?? nullableString(value.short_name) ?? value.id,
          latitude: value.lat,
          longitude: value.lon,
          municipalityId: nullableString(value.municipality_id),
          districtId: nullableString(value.district_id),
          parishId: nullableString(value.parish_id),
          localityId: nullableString(value.locality_id),
          wheelchairBoarding: isJsonBoolean(value.wheelchair_boarding) ? value.wheelchair_boarding : null,
          lineIds: stringArray(value.line_ids),
          routeIds: stringArray(value.route_ids),
        },
      },
    ];
  });
  return result(values.length, records.length, [
    {
      productKey: "stops",
      slug: "carris-stops",
      title: "Carris Metropolitana stops",
      description: "Every stop in the network with its position, municipality, and served lines.",
      role: "reference",
      schema: STOP_SCHEMA,
      kind: "record",
      records,
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    },
  ]);
}

function transformVehicles(values: JsonValue[], context: TransformContext): UnstampedResult {
  const records = values.flatMap((value) => {
    if (!isJsonObject(value) || !string(value.id) || value.id.includes("undefined") || !number(value.lat) || !number(value.lon) || !number(value.timestamp)) {
      return [];
    }
    const eventTime = unixTime(value.timestamp);
    const sourceSequence = nullableString(value.event_id);
    const record: CanonicalRecord = {
      entityKey: value.id,
      eventTime,
      payload: {
        id: value.id,
        agencyId: nullableString(value.agency_id),
        lineId: nullableString(value.line_id),
        routeId: nullableString(value.route_id),
        patternId: nullableString(value.pattern_id),
        tripId: nullableString(value.trip_id),
        stopId: nullableString(value.stop_id),
        latitude: value.lat,
        longitude: value.lon,
        bearing: nullableNumber(value.bearing),
        speed: nullableNumber(value.speed),
        status: nullableString(value.current_status),
        doorStatus: nullableString(value.door_status),
        eventTime,
        propulsion: nullableString(value.propulsion),
        make: nullableString(value.make),
        model: nullableString(value.model),
        owner: nullableString(value.owner),
        licensePlate: nullableString(value.license_plate),
        capacityTotal: nullableNumber(value.capacity_total),
        wheelchairAccessible: isJsonBoolean(value.wheelchair_accessible) ? value.wheelchair_accessible : null,
        bikesAllowed: isJsonBoolean(value.bikes_allowed) ? value.bikes_allowed : null,
      },
    };
    if (sourceSequence) record.sourceSequence = sourceSequence;
    return [record];
  });

  const latestEventTime =
    records
      .map((record) => record.eventTime)
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? context.observedAt;
  const measuredAt = new Date(Math.floor(new Date(latestEventTime).getTime() / 60_000) * 60_000).toISOString();
  const agencyCounts = new Map<string, number>();
  const propulsionByAgency = new Map<string, Map<string, number>>();
  for (const record of records) {
    const agency = String(record.payload.agencyId ?? "unknown");
    const propulsion = String(record.payload.propulsion ?? "unknown");
    agencyCounts.set(agency, (agencyCounts.get(agency) ?? 0) + 1);
    const counts = propulsionByAgency.get(agency) ?? new Map<string, number>();
    counts.set(propulsion, (counts.get(propulsion) ?? 0) + 1);
    propulsionByAgency.set(agency, counts);
  }

  const summaryRecords = [...agencyCounts.entries()].map(([agencyId, activeVehicles]) => ({
    entityKey: agencyId,
    eventTime: measuredAt,
    payload: {
      agencyId,
      activeVehicles,
      vehiclesByPropulsion: Object.fromEntries(propulsionByAgency.get(agencyId) ?? []),
      measuredAt,
    },
  }));
  summaryRecords.push({
    entityKey: "all",
    eventTime: measuredAt,
    payload: {
      agencyId: "all",
      activeVehicles: records.length,
      vehiclesByPropulsion: Object.fromEntries(
        [...propulsionByAgency.values()].reduce((totals, counts) => {
          for (const [propulsion, count] of counts) {
            totals.set(propulsion, (totals.get(propulsion) ?? 0) + count);
          }
          return totals;
        }, new Map<string, number>()),
      ),
      measuredAt,
    },
  });
  const points = [
    {
      seriesKey: "all",
      eventTime: measuredAt,
      value: records.length,
      unit: "vehicle",
      dimensions: { scope: "network" },
    },
    ...[...agencyCounts.entries()].map(([agencyId, value]) => ({
      seriesKey: `agency:${agencyId}`,
      eventTime: measuredAt,
      value,
      unit: "vehicle",
      dimensions: { agencyId },
    })),
  ];

  const products: ProductBuild[] = [
    {
      productKey: "vehicles-current",
      slug: "carris-vehicles-current",
      title: "Carris Metropolitana vehicles",
      description: "The latest valid vehicle position and operating state.",
      role: "current-state",
      schema: VEHICLE_SCHEMA,
      kind: "record",
      records,
      updateMode: "authoritative-snapshot",
      completeness: "complete",
      watermark: latestEventTime,
    },
    {
      productKey: "fleet-summary",
      slug: "carris-fleet-summary",
      title: "Carris Metropolitana fleet summary",
      description: "Current active vehicle counts by operator and propulsion.",
      role: "summary",
      schema: SUMMARY_SCHEMA,
      kind: "record",
      records: summaryRecords,
      updateMode: "authoritative-snapshot",
      completeness: "complete",
      watermark: measuredAt,
    },
    {
      productKey: "active-vehicles-series",
      slug: "carris-active-vehicles-series",
      title: "Carris Metropolitana active vehicles over time",
      description: "Active vehicle counts for the network and each operator, measured every minute.",
      role: "time-series",
      schema: SERIES_SCHEMA,
      kind: "series",
      points,
      updateMode: "delta",
      completeness: "complete",
      watermark: measuredAt,
    },
  ];
  return result(values.length, records.length, products);
}

function transformAlerts(values: JsonValue[]): UnstampedResult {
  const records = values.flatMap((value) => {
    if (!isJsonObject(value) || !string(value.alert_id)) return [];
    const periods = Array.isArray(value.active_period) ? value.active_period.filter(isJsonObject) : [];
    const starts = periods.map((period) => nullableNumber(period.start)).filter((time): time is number => time !== null);
    const ends = periods.map((period) => nullableNumber(period.end)).filter((time): time is number => time !== null);
    const validFrom = starts.length > 0 ? unixTime(Math.min(...starts)) : undefined;
    const validTo = ends.length > 0 ? unixTime(Math.max(...ends)) : undefined;
    const record: CanonicalRecord = {
      entityKey: value.alert_id,
      operation: "upsert",
      payload: {
        id: value.alert_id,
        title: translation(value.header_text) ?? "Service alert",
        description: translation(value.description_text) ?? null,
        cause: nullableString(value.cause),
        effect: nullableString(value.effect),
        informedEntities: Array.isArray(value.informed_entity) ? value.informed_entity : [],
        validFrom: validFrom ?? null,
        validTo: validTo ?? null,
      },
    };
    // An alert happens when it takes effect. The poll time is no fact about the alert: stamped on it,
    // every alert would be a new revision on every collection. An alert with no period has no time of its own.
    if (validFrom) {
      record.eventTime = validFrom;
      record.validFrom = validFrom;
    }
    if (validTo) record.validTo = validTo;
    return [record];
  });
  const alerts: ProductBuild = {
    productKey: "service-alerts",
    slug: "carris-service-alerts",
    title: "Carris Metropolitana service alerts",
    description: "Current disruptions, each dated by when it takes effect, with its validity period.",
    role: "event-log",
    schema: ALERT_SCHEMA,
    kind: "record",
    records,
    updateMode: "source-window",
    completeness: "complete",
  };
  const newest = records
    .map((record) => record.eventTime)
    .filter((time): time is string => time !== undefined)
    .sort()
    .at(-1);
  if (newest) alerts.watermark = newest;
  return result(values.length, records.length, [alerts]);
}

function result(inputCount: number, acceptedRecords: number, products: ProductBuild[]): UnstampedResult {
  return {
    products,
    quality: { acceptedRecords, rejectedRecords: inputCount - acceptedRecords },
  };
}

function translation(value: JsonValue | undefined): string | undefined {
  if (!isJsonObject(value) || !Array.isArray(value.translation)) return undefined;
  const translations = value.translation.filter(isJsonObject);
  const portuguese = translations.find((item) => item.language === "pt");
  const first = portuguese ?? translations[0];
  return first ? (nullableString(first.text) ?? undefined) : undefined;
}

function string(value: JsonValue | undefined): value is string {
  return isJsonString(value) && value.length > 0;
}
function number(value: JsonValue | undefined): value is number {
  return isJsonNumber(value) && Number.isFinite(value);
}
function nullableString(value: JsonValue | undefined): string | null {
  return isJsonString(value) && value.length > 0 ? value : null;
}
function nullableNumber(value: JsonValue | undefined): number | null {
  return number(value) ? value : null;
}
function stringArray(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.filter(string) : [];
}
function unixTime(value: number): string {
  // /v2/vehicles moved from Unix seconds to milliseconds in September 2026. A
  // time in seconds stays below 1e11 until the year 5138, so larger values are
  // already milliseconds.
  return new Date(value >= 100_000_000_000 ? value : value * 1000).toISOString();
}
