import {
  GatekeeperError,
  field,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type CanonicalSchema,
  type JsonValue,
  type ProductBuild,
  type SeriesPoint,
  type TransformContext,
  type UnstampedResult,
} from "#/index";
import { validateNasaPowerFeedConfig } from "./nasapower";

const SCHEMA: CanonicalSchema = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};

export class NasaPowerTransformer {
  readonly id = "nasa-power-daily-json";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const config = validateNasaPowerFeedConfig(context.feed.config);
    const parameter = config.parameter;
    if (!parameter) throw new GatekeeperError("NASA POWER parameter was not resolved", "invalid-config");
    const root = parseJsonBytes(bytes);
    if (!isJsonObject(root) || root.type !== "FeatureCollection" || !Array.isArray(root.features) || !isJsonObject(root.parameters))
      throw new GatekeeperError("NASA POWER returned an invalid feature collection", "invalid-response");
    const metadata = root.parameters[parameter];
    if (!isJsonObject(metadata) || !isJsonString(metadata.units) || metadata.units.trim() === "")
      throw new GatekeeperError("NASA POWER omitted parameter units", "invalid-response");
    const unit = metadata.units.trim();
    const points: SeriesPoint[] = [];
    let rejected = 0;
    let watermark: string | undefined;
    for (const candidate of root.features) {
      const result = gridPoints(candidate, parameter, unit);
      if (!result) {
        rejected += 1;
        continue;
      }
      points.push(...result);
      const latest = result.at(-1)?.eventTime;
      if (latest && (!watermark || latest > watermark)) watermark = latest;
    }
    const product: ProductBuild = {
      productKey: "daily-grid",
      slug: context.feed.slug.replace(/-feed$/u, ""),
      title: context.feed.title,
      description: context.feed.description,
      role: "time-series",
      schema: SCHEMA,
      points,
      kind: "series",
      updateMode: "source-window",
      completeness: "complete",
    };
    if (watermark) product.watermark = watermark;
    return { products: [product], quality: { acceptedRecords: points.length, rejectedRecords: rejected } };
  }
}

function gridPoints(value: JsonValue | undefined, parameter: string, unit: string): SeriesPoint[] | undefined {
  if (!isJsonObject(value) || !isJsonObject(value.geometry) || !Array.isArray(value.geometry.coordinates) || !isJsonObject(value.properties)) return undefined;
  const coordinates = value.geometry.coordinates;
  const longitude = finite(coordinates[0]);
  const latitude = finite(coordinates[1]);
  const elevation = finite(coordinates[2]);
  const parameters = value.properties.parameter;
  if (longitude === undefined || latitude === undefined || !isJsonObject(parameters) || !isJsonObject(parameters[parameter])) return undefined;
  const values = parameters[parameter];
  const dimensions: SeriesPoint["dimensions"] = { parameter, latitude: String(latitude), longitude: String(longitude) };
  if (elevation !== undefined) dimensions.elevationMetres = String(elevation);
  const seriesKey = `${latitude.toFixed(3)},${longitude.toFixed(3)}`;
  return Object.entries(values)
    .flatMap(([date, candidate]): SeriesPoint[] => {
      if (!/^\d{8}$/u.test(date) || !isJsonNumber(candidate) || !Number.isFinite(candidate) || candidate === -999) return [];
      const eventTime = compactDate(date);
      return eventTime ? [{ seriesKey, eventTime, value: candidate, unit, dimensions }] : [];
    })
    .sort((left, right) => left.eventTime.localeCompare(right.eventTime));
}

function compactDate(value: string): string | undefined {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day) return undefined;
  return date.toISOString();
}

function finite(value: JsonValue | undefined): number | undefined {
  return isJsonNumber(value) && Number.isFinite(value) ? value : undefined;
}
