import {
  field,
  isJsonBoolean,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type CanonicalRecord,
  type CanonicalSchema,
  type JsonValue,
  type ProductBuild,
  type TransformContext,
  type TransformResult,
} from "../../index";
import { dgegDateTime } from "./dgeg";

const FUEL_TYPE_SCHEMA: CanonicalSchema = {
  fields: [
    field("id", "identifier", false),
    {
      ...field("name", "string", false),
      display: { badge: { colorField: "color" } },
    },
    field("unit", "category", false),
    field("roadFuel", "boolean", false),
    field("active", "boolean", false),
    field("visibleOnWebsite", "boolean", true),
    field("color", "color", true),
  ],
};

export class DgegTransformer {
  readonly id = "dgeg-fuel-prices";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): TransformResult {
    const value = parseArtifact(bytes);
    switch (context.feed.config.feed) {
      case "fuel-types":
        return stamp(transformFuelTypes(value));
      case "fuel-prices":
        return stamp(transformFuelPrices(value, context));
      default:
        throw new Error(`Unsupported DGEG feed: ${context.feed.config.feed}`);
    }
  }
}

function transformFuelTypes(value: JsonValue | undefined): Omit<TransformResult, "transformer"> {
  const values = envelopeResults(value);
  const records = values.flatMap((candidate): CanonicalRecord[] => {
    if (!isJsonObject(candidate)) return [];
    const id = integer(candidate.Id);
    const name = text(candidate.Descritivo);
    const unit = text(candidate.UnidadeMedida);
    if (id === undefined || !name || !unit) return [];
    if (!isJsonBoolean(candidate.fl_rodoviario) || !isJsonBoolean(candidate.fl_ativo)) {
      return [];
    }
    return [{
      entityKey: String(id),
      payload: {
        id: String(id),
        name,
        unit,
        roadFuel: candidate.fl_rodoviario,
        active: candidate.fl_ativo,
        visibleOnWebsite:
          isJsonBoolean(candidate.fl_ViewWebSite)
            ? candidate.fl_ViewWebSite
            : null,
        color: hexColor(candidate.BackGroundColor),
      },
    }];
  });
  return result(values.length, records.length, [{
    productKey: "fuel-types",
    slug: "dgeg-fuel-types",
    title: "DGEG fuel types",
    description: "Fuel types and units published by Preços dos Combustíveis Online.",
    role: "reference",
    schema: FUEL_TYPE_SCHEMA,
    records,
    kind: "record",
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  }]);
}

function transformFuelPrices(
  value: JsonValue | undefined,
  context: TransformContext,
): Omit<TransformResult, "transformer"> {
  if (!isJsonObject(value)) throw new Error("DGEG fuel-price document must be an object");
  const fuelType = parseFuelType(value.fuelType);
  const district = value.district === null ? null : parseDistrict(value.district);
  if (!fuelType || value.district !== null && !district) {
    throw new Error("DGEG fuel-price document has invalid source metadata");
  }
  if (!Number.isSafeInteger(value.fetchedPages) || !Array.isArray(value.stations)) {
    throw new Error("DGEG fuel-price document has invalid pagination metadata");
  }

  const priceUnit = priceUnitFor(fuelType.unit);
  const records = value.stations.flatMap((station): CanonicalRecord[] => {
    if (!isJsonObject(station)) return [];
    const id = integer(station.Id);
    const name = text(station.Nome);
    const municipality = text(station.Municipio);
    const stationDistrict = text(station.Distrito);
    const price = parsePrice(station.Preco);
    const updatedAt = isJsonString(station.DataAtualizacao)
      ? dgegDateTime(station.DataAtualizacao)
      : undefined;
    if (
      id === undefined || !name || !municipality || !stationDistrict ||
      price === undefined || !updatedAt
    ) {
      return [];
    }
    return [{
      entityKey: String(id),
      eventTime: updatedAt,
      payload: {
        id: String(id),
        name,
        brand: nullableText(station.Marca),
        stationType: nullableText(station.TipoPosto),
        municipality,
        district: stationDistrict,
        address: nullableText(station.Morada),
        locality: nullableText(station.Localidade),
        postalCode: nullableText(station.CodPostal),
        latitude: coordinate(station.Latitude, -90, 90),
        longitude: coordinate(station.Longitude, -180, 180),
        price,
        updatedAt,
      },
    }];
  });

  // One point per municipality per day. A median that moves during the day revises that day's point; one that
  // does not writes nothing. Stamped with the hour, every hourly collection made every median a new point.
  const day = truncateToDay(context.observedAt);
  const byMunicipality = new Map<string, CanonicalRecord[]>();
  for (const record of records) {
    const municipality = String(record.payload.municipality);
    const group = byMunicipality.get(municipality) ?? [];
    group.push(record);
    byMunicipality.set(municipality, group);
  }
  const points = [...byMunicipality.entries()]
    .sort(([left], [right]) => left.localeCompare(right, "pt"))
    .map(([municipality, municipalityRecords]) => {
      const prices = municipalityRecords
        .map((record) => Number(record.payload.price))
        .sort((left, right) => left - right);
      const middle = Math.floor(prices.length / 2);
      const value = prices.length % 2 === 0
        ? ((prices[middle - 1] ?? 0) + (prices[middle] ?? 0)) / 2
        : prices[middle] ?? 0;
      const districtName = String(municipalityRecords[0]?.payload.district ?? "");
      return {
        seriesKey: municipality,
        eventTime: day,
        value,
        unit: priceUnit,
        dimensions: { district: districtName, municipality },
      };
    });

  const scope = district ? ` in ${district.name}` : " in mainland Portugal";
  const scopeSlug = district ? `${fuelType.id}-district-${district.id}` : String(fuelType.id);
  const stationSchema: CanonicalSchema = {
    fields: [
      field("id", "identifier", false),
      field("name", "string", false),
      field("brand", "category", true),
      field("stationType", "category", true),
      field("municipality", "category", false),
      field("district", "category", false),
      field("address", "string", true),
      field("locality", "string", true),
      field("postalCode", "string", true),
      field("latitude", "latitude", true),
      field("longitude", "longitude", true),
      field("price", "number", false, priceUnit),
      field("updatedAt", "datetime", false),
    ],
  };
  const seriesSchema: CanonicalSchema = {
    fields: [
      field("seriesKey", "identifier", false),
      field("eventTime", "datetime", false),
      field("value", "number", false, priceUnit),
      field("dimensions", "json", false),
    ],
  };
  const latestUpdate = records
    .map((record) => record.eventTime)
    .filter(isString)
    .sort()
    .at(-1);
  const products: ProductBuild[] = [
    {
      productKey: "stations",
      slug: `stations-${scopeSlug}`,
      title: `${fuelType.name} station prices${scope}`,
      description: `Current ${fuelType.name} prices reported by fuel stations${scope}.`,
      role: "current-state",
      schema: stationSchema,
      records,
      kind: "record",
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    },
    {
      productKey: "price-by-municipality",
      slug: `price-by-municipality-${scopeSlug}`,
      title: `Median ${fuelType.name} price by municipality${scope}`,
      description: `Daily median station price for ${fuelType.name} in each municipality${scope} (UTC days), revised during the day as stations report new prices.`,
      role: "time-series",
      schema: seriesSchema,
      points,
      kind: "series",
      updateMode: "delta",
      completeness: "complete",
      watermark: day,
    },
  ];
  if (latestUpdate && products[0]) products[0].watermark = latestUpdate;
  return result(value.stations.length, records.length, products);
}

function result(
  inputCount: number,
  acceptedRecords: number,
  products: ProductBuild[],
): Omit<TransformResult, "transformer"> {
  const rejectedRecords = inputCount - acceptedRecords;
  return {
    products,
    quality: { acceptedRecords, rejectedRecords },
  };
}

function stamp(resultValue: Omit<TransformResult, "transformer">): TransformResult {
  return {
    ...resultValue,
    transformer: { id: "dgeg-fuel-prices", version: "1" },
  };
}

function parseArtifact(bytes: Uint8Array): JsonValue {
  try {
    return parseJsonBytes(bytes);
  } catch {
    throw new Error("DGEG artifact is not valid JSON");
  }
}

function envelopeResults(value: JsonValue | undefined): JsonValue[] {
  if (
    !isJsonObject(value) ||
    value.status !== true ||
    !Array.isArray(value.resultado)
  ) {
    throw new Error("DGEG artifact has an invalid response envelope");
  }
  return value.resultado;
}

function parseFuelType(value: JsonValue | undefined): { id: number; name: string; unit: string } | undefined {
  if (!isJsonObject(value)) return undefined;
  const id = integer(value.Id);
  const name = text(value.Descritivo);
  const unit = text(value.UnidadeMedida);
  return id === undefined || !name || !unit ? undefined : { id, name, unit };
}

function parseDistrict(value: JsonValue | undefined): { id: number; name: string } | undefined {
  if (!isJsonObject(value)) return undefined;
  const id = integer(value.Id);
  const name = text(value.Descritivo);
  return id === undefined || !name ? undefined : { id, name };
}


function integer(value: JsonValue | undefined): number | undefined {
  return isJsonNumber(value) && Number.isSafeInteger(value) ? value : undefined;
}

function text(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" ? value.trim() : undefined;
}

function nullableText(value: JsonValue | undefined): string | null {
  return text(value) ?? null;
}

function coordinate(value: JsonValue | undefined, minimum: number, maximum: number): number | null {
  return isJsonNumber(value) && Number.isFinite(value) && value >= minimum && value <= maximum
    ? value
    : null;
}

function parsePrice(value: JsonValue | undefined): number | undefined {
  if (!isJsonString(value)) return undefined;
  const match = /^(\d+(?:[.,]\d+)?)\s*€(?:\/(?:litro|kg|m3))?$/.exec(value.trim());
  if (!match?.[1]) return undefined;
  const price = Number(match[1].replace(",", "."));
  return Number.isFinite(price) ? price : undefined;
}

function priceUnitFor(sourceUnit: string): string {
  switch (sourceUnit.trim().toLowerCase()) {
    case "litro":
      return "EUR/l";
    case "kg":
      return "EUR/kg";
    case "m3":
      return "EUR/m³";
    default:
      return `EUR/${sourceUnit.trim()}`;
  }
}

function hexColor(value: JsonValue | undefined): string | null {
  if (!isJsonString(value)) return null;
  const candidate = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(candidate)) return candidate.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(candidate)) return `#${candidate.toUpperCase()}`;
  return null;
}

function truncateToDay(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) throw new Error("Transform context observedAt is invalid");
  return new Date(Math.floor(timestamp / 86_400_000) * 86_400_000).toISOString();
}

function isString(value: string | undefined): value is string {
  return value !== undefined;
}
