import {
  field,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonObject,
  type JsonValue,
  type ProductBuild,
  type SeriesPoint,
  type TransformContext,
  type TransformResult,
} from "../../index";

const VEHICLE_SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("isReserved", "boolean", true),
    field("isDisabled", "boolean", true),
    field("vehicleType", "category", false),
    field("vehicleTypeId", "identifier", true),
    field("currentRangeMeters", "number", true, "m"),
    field("batteryPercent", "number", true, "%"),
    field("lastReported", "datetime", true),
  ],
};

const STATION_SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    field("name", "string", false),
    field("latitude", "latitude", false),
    field("longitude", "longitude", false),
    field("address", "string", true),
    field("capacity", "number", true, "vehicles"),
    field("numBikesAvailable", "number", true, "vehicles"),
    field("numDocksAvailable", "number", true, "docks"),
    field("isInstalled", "boolean", true),
    field("isRenting", "boolean", true),
    field("isReturning", "boolean", true),
    field("lastReported", "datetime", true),
  ],
};

const FLEET_SCHEMA: CanonicalSchema = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false, "vehicles"),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};

const SYSTEM_SCHEMA: CanonicalSchema = {
  fields: [
    field("systemId", "identifier", false),
    field("name", "string", false),
    field("operator", "string", true),
    field("url", "url", true),
    field("timezone", "category", true),
    field("licenceUrl", "url", true),
  ],
};

interface VehicleTypeDescription {
  id: string;
  formFactor: string;
  propulsion: string;
  label: string;
}

interface TransformedVehicles {
  records: CanonicalRecord[];
  points: SeriesPoint[];
  rejected: number;
  eventTime: string;
}

interface TransformedStations {
  records: CanonicalRecord[];
  rejected: number;
  watermark?: string;
}

export class GbfsTransformer {
  readonly id = "gbfs";
  readonly version = "2";

  transform(bytes: Uint8Array, context: TransformContext): TransformResult {
    const root = parseDocument(bytes);
    const systemResource = optionalResource(root.system_information);
    const systemData = systemResource
      ? resourceData(systemResource, "system_information")
      : undefined;
    const systemId = systemData
      ? requiredString(systemData.system_id, "GBFS system_id")
      : context.feed.slug;
    const preferredLanguage = context.feed.config.language;
    const systemName = systemData
      ? requiredLocalizedString(
          systemData.name,
          preferredLanguage,
          "GBFS system name",
        )
      : undefined;
    const operator = systemData
      ? localizedString(
          systemData.operator ?? systemData.attribution_organization_name,
          preferredLanguage,
        )
      : null;
    const titles = productTitles(
      systemName,
      operator,
      context.feed.slug,
    );
    const vehicleTypes = parseVehicleTypes(root.vehicle_types);
    const vehicleResource = optionalResource(root.free_bike_status);
    const stationInformation = optionalResource(root.station_information);
    const stationStatus = optionalResource(root.station_status);
    const products: ProductBuild[] = [];
    let acceptedRecords = systemData ? 1 : 0;
    let rejectedRecords = 0;

    if (vehicleResource) {
      const vehicles = transformVehicles(
        vehicleResource,
        vehicleTypes,
        systemId,
      );
      acceptedRecords += vehicles.records.length;
      rejectedRecords += vehicles.rejected;
      products.push({
        productKey: "vehicles",
        slug: `${context.feed.slug}-vehicles`,
        title: titles.vehicles,
        description: "Current vehicle locations, availability, type, range, and battery level.",
        role: "current-state",
        schema: VEHICLE_SCHEMA,
        records: vehicles.records,
        kind: "record",
        updateMode: "authoritative-snapshot",
        completeness: "complete",
        watermark: vehicles.eventTime,
      });

      products.push({
        productKey: "fleet",
        slug: `${context.feed.slug}-fleet`,
        title: titles.fleet,
        description: "Available, reserved, and disabled vehicle counts over time.",
        role: "time-series",
        schema: FLEET_SCHEMA,
        points: vehicles.points,
        kind: "series",
        updateMode: "delta",
        completeness: "complete",
        watermark: vehicles.eventTime,
      });
    }

    if (stationInformation || stationStatus) {
      const stations = transformStations(
        stationInformation,
        stationStatus,
        preferredLanguage,
      );
      acceptedRecords += stations.records.length;
      rejectedRecords += stations.rejected;
      const stationProduct: ProductBuild = {
        productKey: "stations",
        slug: `${context.feed.slug}-stations`,
        title: titles.stations,
        description: "Station locations, capacity, and current vehicle and dock availability.",
        role: "current-state",
        schema: STATION_SCHEMA,
        records: stations.records,
        kind: "record",
        updateMode: "authoritative-snapshot",
        completeness: "complete",
      };
      if (stations.watermark) stationProduct.watermark = stations.watermark;
      products.splice(vehicleResource ? 1 : 0, 0, stationProduct);
    }

    if (systemData && systemName) {
      const systemRecord: CanonicalRecord = {
        entityKey: systemId,
        payload: {
          systemId,
          name: systemName,
          operator,
          url: validUrl(localizedString(systemData.url, preferredLanguage)),
          timezone: nullableString(systemData.timezone),
          licenceUrl: validUrl(
            localizedString(
              systemData.license_url ?? systemData.licence_url,
              preferredLanguage,
            ),
          ),
        },
      };
      products.push({
        productKey: "system",
        slug: `${context.feed.slug}-system`,
        title: titles.system,
        description: "Operator, website, timezone, and licence information published by the GBFS system.",
        role: "reference",
        schema: SYSTEM_SCHEMA,
        records: [systemRecord],
        kind: "record",
        updateMode: "authoritative-snapshot",
        completeness: "complete",
      });
    }

    return {
      transformer: { id: this.id, version: this.version },
      products,
      quality: { acceptedRecords, rejectedRecords },
    };
  }
}

function parseDocument(bytes: Uint8Array): JsonObject {
  let value: JsonValue;
  try {
    value = parseJsonBytes(bytes);
  } catch {
    throw new Error("GBFS captured document must be valid JSON");
  }
  if (!isJsonObject(value)) throw new Error("GBFS captured document must be an object");
  return value;
}

function optionalResource(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

function resourceData(
  resource: JsonObject,
  name: string,
): JsonObject {
  if (!isJsonObject(resource.data)) throw new Error(`GBFS ${name} requires data`);
  return resource.data;
}

function parseVehicleTypes(value: JsonValue | undefined): Map<string, VehicleTypeDescription> {
  const resource = optionalResource(value);
  if (!resource) return new Map();
  const data = resourceData(resource, "vehicle_types");
  const values = Array.isArray(data.vehicle_types) ? data.vehicle_types : [];
  const result = new Map<string, VehicleTypeDescription>();
  for (const candidate of values) {
    if (!isJsonObject(candidate) || !nonEmptyString(candidate.vehicle_type_id)) continue;
    const formFactor = nullableString(candidate.form_factor) ?? "unknown";
    const propulsion = nullableString(candidate.propulsion_type) ?? "unknown";
    result.set(candidate.vehicle_type_id, {
      id: candidate.vehicle_type_id,
      formFactor,
      propulsion,
      label: `${formFactor}:${propulsion}`,
    });
  }
  return result;
}

function transformVehicles(
  resource: JsonObject,
  vehicleTypes: Map<string, VehicleTypeDescription>,
  systemId: string,
): TransformedVehicles {
  const data = resourceData(resource, "vehicle status");
  const values = Array.isArray(data.bikes)
    ? data.bikes
    : Array.isArray(data.vehicles)
      ? data.vehicles
      : [];
  const publicationTime = requiredDateTime(
    resource.last_updated,
    "GBFS vehicle last_updated",
  );
  const records: CanonicalRecord[] = [];
  const available = new Map(
    [...vehicleTypes.values()].map((description) => [description.label, 0]),
  );
  let disabled = 0;
  let reserved = 0;
  let rejected = 0;

  for (const value of values) {
    if (!isJsonObject(value)) {
      rejected += 1;
      continue;
    }
    const id = nullableString(value.vehicle_id) ?? nullableString(value.bike_id);
    const latitude = finiteNumber(value.lat);
    const longitude = finiteNumber(value.lon);
    if (!id || latitude === null || longitude === null) {
      rejected += 1;
      continue;
    }
    const vehicleTypeId = nullableString(value.vehicle_type_id);
    const legacyType = nullableString(value.vehicle_type);
    const description = vehicleTypeId
      ? vehicleTypes.get(vehicleTypeId)
      : undefined;
    const vehicleType =
      description?.label ??
      (legacyType ? `${legacyType}:unknown` : "unknown:unknown");
    const isReserved = nullableBoolean(value.is_reserved);
    const isDisabled = nullableBoolean(value.is_disabled);
    const lastReported = dateTime(value.last_reported);
    if (!available.has(vehicleType)) available.set(vehicleType, 0);
    if (isDisabled === true) disabled += 1;
    if (isReserved === true) reserved += 1;
    if (isDisabled !== true && isReserved !== true) {
      available.set(vehicleType, (available.get(vehicleType) ?? 0) + 1);
    }
    records.push({
      entityKey: id,
      eventTime: lastReported ?? publicationTime,
      payload: {
        id,
        latitude,
        longitude,
        isReserved,
        isDisabled,
        vehicleType,
        vehicleTypeId,
        currentRangeMeters: finiteNumber(value.current_range_meters),
        batteryPercent: batteryPercent(value.current_fuel_percent),
        lastReported: lastReported ?? null,
      },
    });
  }

  const dimensions = { system: systemId };
  const points: SeriesPoint[] = [
    ...[...available.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([seriesKey, count]) => ({
        seriesKey,
        eventTime: publicationTime,
        value: count,
        unit: "vehicles",
        dimensions,
      })),
    {
      seriesKey: "disabled",
      eventTime: publicationTime,
      value: disabled,
      unit: "vehicles",
      dimensions,
    },
    {
      seriesKey: "reserved",
      eventTime: publicationTime,
      value: reserved,
      unit: "vehicles",
      dimensions,
    },
  ];
  return { records, points, rejected, eventTime: publicationTime };
}

function transformStations(
  informationResource: JsonObject | undefined,
  statusResource: JsonObject | undefined,
  preferredLanguage: string | undefined,
): TransformedStations {
  const informationData = informationResource
    ? resourceData(informationResource, "station_information")
    : undefined;
  const statusData = statusResource
    ? resourceData(statusResource, "station_status")
    : undefined;
  const information = Array.isArray(informationData?.stations)
    ? informationData.stations
    : [];
  const statuses = Array.isArray(statusData?.stations) ? statusData.stations : [];
  const statusById = new Map<string, JsonObject>();
  let rejected = 0;
  for (const value of statuses) {
    if (!isJsonObject(value) || !nonEmptyString(value.station_id)) {
      rejected += 1;
      continue;
    }
    statusById.set(value.station_id, value);
  }

  const records: CanonicalRecord[] = [];
  for (const value of information) {
    if (!isJsonObject(value) || !nonEmptyString(value.station_id)) {
      rejected += 1;
      continue;
    }
    const latitude = finiteNumber(value.lat);
    const longitude = finiteNumber(value.lon);
    if (latitude === null || longitude === null) {
      rejected += 1;
      continue;
    }
    const status = statusById.get(value.station_id);
    if (status) statusById.delete(value.station_id);
    const lastReported = dateTime(status?.last_reported);
    const record: CanonicalRecord = {
      entityKey: value.station_id,
      payload: {
        id: value.station_id,
        name:
          localizedString(value.name, preferredLanguage) ?? value.station_id,
        latitude,
        longitude,
        address: localizedString(value.address, preferredLanguage),
        capacity: finiteNumber(value.capacity),
        numBikesAvailable: finiteNumber(
          status?.num_bikes_available ?? status?.num_vehicles_available,
        ),
        numDocksAvailable: finiteNumber(status?.num_docks_available),
        isInstalled: nullableBoolean(status?.is_installed),
        isRenting: nullableBoolean(status?.is_renting),
        isReturning: nullableBoolean(status?.is_returning),
        lastReported: lastReported ?? null,
      },
    };
    if (lastReported) record.eventTime = lastReported;
    records.push(record);
  }

  const unmatched = statusById.size;
  rejected += unmatched;
  const watermark = statusResource
    ? dateTime(statusResource.last_updated)
    : informationResource
      ? dateTime(informationResource.last_updated)
      : undefined;
  const transformed: TransformedStations = { records, rejected };
  if (watermark) transformed.watermark = watermark;
  return transformed;
}

function localizedString(
  value: JsonValue | undefined,
  preferredLanguage: string | undefined,
): string | null {
  const direct = nullableString(value);
  if (direct) return direct;
  if (!Array.isArray(value)) return null;
  const translations = value.filter(
    (entry): entry is JsonObject =>
      isJsonObject(entry) && nonEmptyString(entry.text),
  );
  const preferred = preferredLanguage
    ? translations.find(
        (entry) =>
          nullableString(entry.language)?.toLowerCase() === preferredLanguage,
      )
    : undefined;
  return nullableString((preferred ?? translations[0])?.text);
}

interface ProductTitles {
  vehicles: string;
  stations: string;
  fleet: string;
  system: string;
}

function productTitles(
  systemName: string | undefined,
  operator: string | null,
  feedSlug: string,
): ProductTitles {
  const identity = systemName
    ? systemIdentity(systemName, operator)
    : { brand: capitaliseWords(feedSlug.replace(/[-_]+/gu, " ")) };
  const place = identity.location ? ` in ${identity.location}` : "";
  return {
    vehicles: `${identity.brand} vehicles${place}`,
    stations: `${identity.brand} stations${place}`,
    fleet: `${identity.brand} fleet over time${place}`,
    system: `${identity.brand} system information${place}`,
  };
}

/** How a system names itself: the brand it runs under, and where it runs. */
interface SystemIdentity {
  brand: string;
  location?: string;
}

function systemIdentity(
  systemName: string,
  operator: string | null,
): SystemIdentity {
  const parenthetical = /^(.*?)\s*\(([^()]+)\)\s*$/u.exec(systemName);
  if (parenthetical?.[1] && parenthetical[2]) {
    return {
      brand: capitaliseWords(parenthetical[1]),
      location: capitaliseWords(parenthetical[2]),
    };
  }

  const operatorWord = operator?.match(/[\p{L}\p{N}]+/u)?.[0];
  if (operatorWord) {
    const prefix = new RegExp(`^${escapeRegExp(operatorWord)}(?:[\\s_-]+)(.+)$`, "iu")
      .exec(systemName);
    if (prefix?.[1]) {
      return {
        brand: capitaliseWords(operatorWord),
        location: capitaliseWords(prefix[1]),
      };
    }
  }
  return { brand: capitaliseWords(systemName) };
}

function capitaliseWords(value: string): string {
  const trimmed = value.trim().replace(/\s+/gu, " ");
  if (/[\p{Lu}].*[\p{Ll}]|[\p{Ll}].*[\p{Lu}]/u.test(trimmed)) {
    return trimmed;
  }
  return trimmed.replace(/(^|[\s-])([\p{Ll}])/gu, (_, separator: string, letter: string) =>
    `${separator}${letter.toLocaleUpperCase("en")}`
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function requiredLocalizedString(
  value: JsonValue | undefined,
  preferredLanguage: string | undefined,
  label: string,
): string {
  const result = localizedString(value, preferredLanguage);
  if (!result) throw new Error(`${label} must be a non-empty string`);
  return result;
}

function requiredString(value: JsonValue | undefined, label: string): string {
  const result = nullableString(value);
  if (!result) throw new Error(`${label} must be a non-empty string`);
  return result;
}

function nonEmptyString(value: JsonValue | undefined): value is string {
  return isJsonString(value) && value.trim() !== "";
}

function nullableString(value: JsonValue | undefined): string | null {
  return nonEmptyString(value) ? value.trim() : null;
}

function finiteNumber(value: JsonValue | undefined): number | null {
  return isJsonNumber(value) && Number.isFinite(value) ? value : null;
}

function nullableBoolean(value: JsonValue | undefined): boolean | null {
  if (isJsonBoolean(value)) return value;
  if (value === 0) return false;
  if (value === 1) return true;
  return null;
}

function batteryPercent(value: JsonValue | undefined): number | null {
  const number = finiteNumber(value);
  if (number === null || number < 0 || number > 100) return null;
  return number <= 1 ? Math.round(number * 10_000) / 100 : number;
}

function dateTime(value: JsonValue | undefined): string | undefined {
  if (isJsonNumber(value) && Number.isFinite(value) && value >= 0) {
    const milliseconds = value < 1_000_000_000_000 ? value * 1000 : value;
    const result = new Date(milliseconds);
    return Number.isNaN(result.getTime()) ? undefined : result.toISOString();
  }
  if (!isJsonString(value) || value.trim() === "") return undefined;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds)
    ? undefined
    : new Date(milliseconds).toISOString();
}

function requiredDateTime(value: JsonValue | undefined, label: string): string {
  const result = dateTime(value);
  if (!result) throw new Error(`${label} must be a date or Unix timestamp`);
  return result;
}

function validUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : null;
  } catch {
    return null;
  }
}
