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
  readonly version = "2";

  /**
   * One series per station and pollutant (`1021:NO2`). A reading's time is the start of its hour in UTC; its averaging
   * period (one hour, or eight for carbon monoxide) and its air quality index (1, very good, to 5, bad) go with it.
   * The day under way gives each station's latest hour; the day before, when the collection read it, every hour.
   */
  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    validateQualarFeedConfig(context.feed.config);
    const document = parseJsonBytes(bytes);
    const latest = isJsonObject(document) ? document.latest : undefined;
    if (!isJsonObject(document) || !isJsonObject(latest) || !isDay(latest.date) || !isJsonArray(latest.pollutants) || !isJsonArray(latest.stations))
      throw new GatekeeperError("QualAr collection is not a document", "invalid-response");
    const points = new Map<string, SeriesPoint>();
    let rejected = 0;
    const keep = (point: SeriesPoint | "none" | undefined): void => {
      if (point === undefined) rejected += 1;
      else if (point !== "none") points.set(`${point.seriesKey}@${point.eventTime}`, point);
    };

    const date = latest.date;
    const pollutants = latest.pollutants.filter(isJsonObject);
    // Once a day has ended QualAr answers its maxima, and for particles its daily mean, still called an hourly mean
    // and filed under hour 0. A column that is not a mean says the day has ended: nothing of that answer is an hour.
    const underWay = pollutants.every((pollutant) => isJsonString(pollutant.averaging) && AVERAGING.has(pollutant.averaging));
    for (const station of underWay ? latest.stations : []) {
      if (!isJsonObject(station) || !isJsonNumber(station.station) || !isJsonArray(station.readings)) {
        rejected += 1;
        continue;
      }
      const name = isJsonString(station.name) ? station.name : String(station.station);
      const id = String(station.station);
      station.readings.forEach((reading, index) => {
        // A pollutant the station does not measure is written as null.
        if (reading === null) return;
        if (!isJsonObject(reading)) return keep(undefined);
        const column = pollutants[index];
        // Which pollutant a value is of is known only by its place among the columns: one that names another is refused.
        if (!column || reading.poluente_id !== column.id) return keep(undefined);
        keep(pointOf(date, id, name, column, reading.hora, reading.avg, reading.indice));
      });
    }

    const day = document.day;
    if (day !== undefined) {
      if (!isJsonObject(day) || !isDay(day.date) || !isJsonArray(day.stations)) throw new GatekeeperError("QualAr collection has a malformed day", "invalid-response");
      for (const station of day.stations) {
        if (!isJsonObject(station) || !isJsonNumber(station.station) || !isJsonArray(station.pollutants) || !isJsonArray(station.values)) {
          rejected += 1;
          continue;
        }
        const name = isJsonString(station.name) ? station.name : String(station.station);
        const columns = station.pollutants.filter(isJsonObject);
        for (const value of station.values) {
          if (!isJsonObject(value) || !isJsonNumber(value.p)) {
            rejected += 1;
            continue;
          }
          const column = columns[value.p];
          if (!column) {
            rejected += 1;
            continue;
          }
          keep(pointOf(day.date, String(station.station), name, column, isJsonString(value.x) ? Number(value.x) : value.x, value.v, value.i));
        }
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
      // Each read shows some hours; the hours before them are kept rather than retracted.
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

function isDay(value: JsonValue | undefined): value is string {
  return isJsonString(value) && /^\d{4}-\d{2}-\d{2}$/u.test(value);
}

/**
 * One reading, or `"none"` for what is not an hourly reading at all: a value QualAr writes as missing, or a column
 * that is not a mean.
 */
function pointOf(
  date: string,
  station: string,
  name: string,
  column: JsonObject,
  hour: JsonValue | undefined,
  amount: JsonValue | undefined,
  index: JsonValue | undefined,
): SeriesPoint | "none" | undefined {
  const averaging = isJsonString(column.averaging) ? AVERAGING.get(column.averaging) : undefined;
  if (!averaging || amount === "N.D." || amount === null || amount === "") return "none";
  const value = isJsonString(amount) ? Number(amount) : isJsonNumber(amount) ? amount : Number.NaN;
  const pollutant = isJsonString(column.pollutant) ? column.pollutant : undefined;
  const unit = isJsonString(column.unit) ? column.unit : undefined;
  if (!isJsonNumber(hour) || !Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isFinite(value) || !pollutant || !unit) return undefined;
  const dimensions: SeriesPoint["dimensions"] = { station, name, pollutant, averaging };
  if (isJsonNumber(index)) dimensions.index = String(index);
  return { seriesKey: `${station}:${pollutant}`, eventTime: `${date}T${String(hour).padStart(2, "0")}:00:00.000Z`, value, unit, dimensions };
}
