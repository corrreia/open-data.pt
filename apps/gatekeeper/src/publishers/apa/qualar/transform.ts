import {
  GatekeeperError,
  field,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type JsonObject,
  type JsonValue,
  type ProductBuild,
  type SeriesPoint,
  type TransformContext,
  type Transformer,
  type UnstampedResult,
} from "#/index";
import { validateQualarFeedConfig } from "./qualar";

/** QualAr's names for the averaging period of each pollutant's value. */
const AVERAGING = new Map([
  ["Média horária", "1 h"],
  ["Média octo-horário", "8 h"],
]);

export class QualarTransformer implements Transformer {
  readonly id = "qualar";
  readonly version = "1";

  /**
   * Each station's latest hour of each pollutant, as one series per station and pollutant (`1021:NO2`). A reading's
   * time is the start of its hour in UTC; its averaging period (one hour, or eight for carbon monoxide), whether it is
   * validated, and its air quality index (1, very good, to 5, bad) go with it.
   */
  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    validateQualarFeedConfig(context.feed.config);
    const document = parseJsonBytes(bytes);
    if (!isJsonObject(document) || !isJsonArray(document.days)) throw new GatekeeperError("QualAr collection is not a document", "invalid-response");
    const points = new Map<string, SeriesPoint>();
    let rejected = 0;
    for (const day of document.days) {
      if (!isJsonObject(day) || !isJsonString(day.date) || !/^\d{4}-\d{2}-\d{2}$/u.test(day.date) || !isJsonArray(day.pollutants) || !isJsonArray(day.stations))
        throw new GatekeeperError("QualAr collection has a malformed day", "invalid-response");
      const date = day.date;
      const pollutants = day.pollutants.filter(isJsonObject);
      for (const station of day.stations) {
        if (!isJsonObject(station) || !isJsonNumber(station.station) || !isJsonArray(station.readings)) {
          rejected += 1;
          continue;
        }
        const name = isJsonString(station.name) ? station.name : String(station.station);
        station.readings.forEach((reading, index) => {
          // A pollutant the station does not measure is written as null, and an hour it has no value for as "N.D.".
          if (reading === null || (isJsonObject(reading) && reading.avg === "N.D.")) return;
          const point = pointOf(date, String(station.station), name, reading, pollutants[index]);
          if (!point) rejected += 1;
          else points.set(`${point.seriesKey}@${point.eventTime}`, point);
        });
      }
    }
    const series = [...points.values()];
    const product: ProductBuild = {
      productKey: "air-quality",
      slug: context.feed.slug.replace(/-feed$/u, ""),
      title: context.feed.title,
      description: context.feed.description,
      role: "time-series",
      kind: "series",
      schema: {
        fields: [
          field("seriesKey", "identifier", false),
          field("eventTime", "datetime", false),
          field("value", "number", false),
          field("unit", "category", false),
          field("dimensions", "json", false),
        ],
      },
      points: series,
      // Each read shows only the latest hours; the hours before them are kept rather than retracted.
      updateMode: "delta",
      completeness: "complete",
    };
    const watermark = series
      .map((point) => point.eventTime)
      .sort()
      .at(-1);
    if (watermark) product.watermark = watermark;
    return { products: [product], quality: { acceptedRecords: series.length, rejectedRecords: rejected } };
  }
}

function pointOf(date: string, station: string, name: string, reading: JsonValue, column: JsonObject | undefined): SeriesPoint | undefined {
  if (!isJsonObject(reading) || !column || reading.poluente_id !== column.id) return undefined;
  const hour = reading.hora;
  const value = isJsonString(reading.avg) ? Number(reading.avg) : isJsonNumber(reading.avg) ? reading.avg : Number.NaN;
  const pollutant = isJsonString(column.pollutant) ? column.pollutant : undefined;
  const unit = isJsonString(column.unit) ? column.unit : undefined;
  const averaging = isJsonString(column.averaging) ? AVERAGING.get(column.averaging) : undefined;
  if (!isJsonNumber(hour) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isFinite(value) || !pollutant || !unit || !averaging) return undefined;
  const dimensions: SeriesPoint["dimensions"] = { station, name, pollutant, averaging, validated: reading.validado === 1 ? "yes" : "no" };
  if (isJsonNumber(reading.indice)) dimensions.index = String(reading.indice);
  return { seriesKey: `${station}:${pollutant}`, eventTime: `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`, value, unit, dimensions };
}
