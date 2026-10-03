import {
  GatekeeperError,
  field,
  isJsonArray,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type JsonValue,
  type ProductBuild,
  type SeriesPoint,
  type TransformContext,
  type Transformer,
  type UnstampedResult,
} from "#/index";
import { picassoChart } from "./picasso";

/** The unit Picasso's charts draw every value in (`unit: "bps"`). */
const UNIT = "bit/s";

export class PicassoTransformer implements Transformer {
  readonly id = "picasso";
  readonly version = "1";

  /**
   * One series, `gigapix`, a point per bucket of the chart, dated by the bucket's start in UTC. The bucket still being
   * filled when the collection was made is left out, so a value is final when first published; it is read whole
   * by the next collection, whose window still holds it. A bucket Picasso holds no value for is left out rather
   * than published as a zero.
   */
  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const chart = picassoChart(context.feed.config);
    const values = seriesValues(bytes, chart.column);
    if (values.length > chart.maxPoints) throw new GatekeeperError("Picasso answered more points than its chart holds", "response-too-large");
    const stepMs = chart.stepSeconds * 1000;
    const observedAt = Date.parse(context.observedAt);
    if (Number.isNaN(observedAt)) throw new GatekeeperError("The collection has no observation time", "invalid-config");
    const points = new Map<string, SeriesPoint>();
    for (const row of values) {
      if (!isJsonArray(row) || row.length !== 2) throw new GatekeeperError("Picasso answered a row that is not a time and a value", "invalid-response");
      const [time, value] = row;
      const start = isJsonString(time) && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/u.test(time) ? Date.parse(time) : Number.NaN;
      if (Number.isNaN(start) || start % stepMs !== 0) throw new GatekeeperError("Picasso answered a time off its chart's grid", "invalid-response");
      if (value === null) continue;
      if (!isJsonNumber(value) || !Number.isFinite(value) || value < 0) throw new GatekeeperError("Picasso answered a value that is not a traffic rate", "invalid-response");
      // The bucket under way when the collection was made: its value is still moving.
      if (start + stepMs > observedAt) continue;
      const eventTime = new Date(start).toISOString();
      points.set(eventTime, { seriesKey: "gigapix", eventTime, value, unit: UNIT, dimensions: { statistic: chart.statistic } });
    }
    const series = [...points.values()];
    const product: ProductBuild = {
      productKey: chart.productKey,
      slug: context.feed.slug.replace(/-feed$/u, ""),
      title: context.feed.title,
      description: context.feed.description,
      role: "time-series",
      kind: "series",
      schema: {
        fields: [
          field("seriesKey", "identifier", false),
          field("eventTime", "datetime", false),
          field("value", "number", false, UNIT),
          field("unit", "category", false),
          field("dimensions", "json", false),
        ],
      },
      points: series,
      // The chart's window slides: what leaves it was not withdrawn, and is kept.
      updateMode: "source-window",
      completeness: "complete",
    };
    const watermark = series
      .map((point) => point.eventTime)
      .toSorted()
      .at(-1);
    if (watermark) product.watermark = watermark;
    return { products: [product], quality: { acceptedRecords: series.length, rejectedRecords: 0 } };
  }
}

/** The rows of Picasso's one `gigapix` series, once its columns are the time and the column the chart reads. */
function seriesValues(bytes: Uint8Array, column: string): JsonValue[] {
  let root: JsonValue;
  try {
    root = parseJsonBytes(bytes);
  } catch {
    throw new GatekeeperError("Picasso answered something that is not JSON", "invalid-response");
  }
  const series = isJsonObject(root) && isJsonArray(root.series) ? root.series : undefined;
  // An answer without a series is a chart with nothing to draw: a source that is down, not a quiet network.
  if (!series || series.length !== 1) throw new GatekeeperError("Picasso answered no GigaPIX series", "invalid-response");
  const only = series[0];
  if (!isJsonObject(only) || only.name !== "gigapix" || !isJsonArray(only.values)) throw new GatekeeperError("Picasso answered a series that is not GigaPIX's", "invalid-response");
  const columns = isJsonArray(only.columns) ? only.columns : [];
  if (columns.length !== 2 || columns[0] !== "time" || columns[1] !== column)
    throw new GatekeeperError(`Picasso answered other columns than time and ${column}`, "invalid-response");
  return only.values;
}
