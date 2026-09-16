import { field, isJsonNumber, isJsonObject, isJsonString, lisbonDay, lisbonInstants, parseJsonBytes } from "../../index";
import type { CanonicalRecord, CanonicalSchema, JsonObject, JsonValue, ProductBuild, SeriesPoint, TransformContext, Transformer, UnstampedResult } from "../../index";
import { isRenNoDataResponse, REN_SERVICES, validateRenFeedConfig, type RenCollectionDocument, type RenServiceName } from "./ren";

interface ParsedSeries {
  name: string;
  key: string;
  color: string | null;
  unit: string;
  values: Array<number | null>;
  eventTimes: Array<string | undefined>;
}

export class RenTransformer implements Transformer {
  readonly id = "ren-chart-services";
  readonly version = "1";

  transform(bytes: Uint8Array, context: TransformContext): UnstampedResult {
    const value: JsonValue = parseJsonBytes(bytes);
    const document = parseDocument(value);
    const config = validateRenFeedConfig(context.feed.config);
    // SAFETY: the feed config was validated by this Gatekeeper, so `service`
    // names one of the services REN_SERVICES declares.
    const service = config.service as RenServiceName;
    if (document.service !== service) {
      throw new Error(`REN collection service ${document.service} does not match feed service ${service}`);
    }
    const definition = REN_SERVICES[service];
    // Only a finished day is summarised: today's totals change with every quarter-hour, and would be a new revision on every collection.
    const today = lisbonDay(context.observedAt);
    const points: SeriesPoint[] = [];
    const summaries: CanonicalRecord[] = [];
    let rejectedRecords = 0;

    for (const day of document.days) {
      if (isRenNoDataResponse(day.response)) continue;
      const chart = parseChart(day.response);
      const eventTimes = categoryEventTimes(day.day, chart.categories, definition.gasDayStartHour);
      const usedKeys = new Map<string, number>();
      const parsedSeries: ParsedSeries[] = [];
      for (const rawSeries of chart.series) {
        if (!isJsonObject(rawSeries) || !isJsonString(rawSeries.name)) {
          rejectedRecords += 1;
          continue;
        }
        if (definition.selectedSeries !== undefined && !definition.selectedSeries.includes(rawSeries.name)) {
          continue;
        }
        if (!Array.isArray(rawSeries.data)) {
          rejectedRecords += 1;
          continue;
        }
        const baseKey = slug(rawSeries.name);
        const collision = usedKeys.get(baseKey) ?? 0;
        usedKeys.set(baseKey, collision + 1);
        const key = collision === 0 ? baseKey : `${baseKey}-${collision + 1}`;
        const values = rawSeries.data.map((item) => {
          if (item === null) return null;
          if (isJsonNumber(item) && Number.isFinite(item)) return item;
          rejectedRecords += 1;
          return null;
        });
        parsedSeries.push({
          name: rawSeries.name,
          key,
          color: hexColor(rawSeries.color),
          unit: chart.unit || definition.unit,
          values,
          eventTimes,
        });
      }
      if (parsedSeries.length === 0) {
        if (chart.series.length === 0) continue;
        throw new Error(`REN chart for ${service} has no supported series`);
      }
      if (parsedSeries.every((series) => series.values.every((value) => value === null))) {
        continue;
      }

      for (const series of parsedSeries) {
        series.values.forEach((valueAtTime, index) => {
          const eventTime = series.eventTimes[index];
          if (valueAtTime === null) return;
          if (eventTime === undefined) {
            rejectedRecords += 1;
            return;
          }
          const dimensions: SeriesPoint["dimensions"] = { source: series.name };
          if (series.color) dimensions.color = series.color;
          points.push({
            seriesKey: series.key,
            eventTime,
            value: valueAtTime,
            unit: series.unit,
            dimensions,
          });
        });
      }

      const consumption = parsedSeries.find((series) => series.name.toLowerCase() === "consumption");
      const consumptionTotal = consumption ? energyMWh(consumption.values, consumption.unit, definition.intervalMinutes) : null;
      for (const series of day.day < today ? parsedSeries : []) {
        const numeric = series.values.filter((item): item is number => item !== null);
        const total = energyMWh(series.values, series.unit, definition.intervalMinutes);
        const lastEventTime = series.eventTimes.filter((item): item is string => item !== undefined).at(-1);
        const summary: CanonicalRecord = {
          entityKey: `${day.day}:${series.key}`,
          payload: {
            day: day.day,
            seriesKey: series.key,
            source: series.name,
            color: series.color,
            unit: series.unit,
            sampleCount: numeric.length,
            totalEnergyMWh: total,
            minimum: numeric.length === 0 ? null : Math.min(...numeric),
            maximum: numeric.length === 0 ? null : Math.max(...numeric),
            shareOfConsumption: total !== null && consumptionTotal !== null && consumptionTotal !== 0 ? round((total / consumptionTotal) * 100) : null,
          },
        };
        if (lastEventTime) summary.eventTime = lastEventTime;
        summaries.push(summary);
      }
    }

    const watermark = points
      .map((point) => point.eventTime)
      .sort()
      .at(-1);
    const products: ProductBuild[] = [
      {
        productKey: "series",
        slug: `ren-${service}-series`,
        title: definition.title,
        description: `${definition.description} Times are converted from Europe/Lisbon to UTC.`,
        role: "time-series",
        schema: seriesSchema(definition.unit),
        points,
        kind: "series",
        updateMode: "delta",
        completeness: "complete",
      },
      {
        productKey: "daily-summary",
        slug: `ren-${service}-daily-summary`,
        title: `${definition.title} daily summary`,
        description: "Energy, minimum, maximum, and share of consumption of each finished day, derived from the source chart values.",
        role: "reference",
        schema: summarySchema(definition.unit),
        records: summaries,
        kind: "record",
        // Each collection sees one or two days; finished days accumulate instead of being retracted as the window moves on.
        updateMode: "delta",
        completeness: "complete",
      },
    ];
    if (watermark) for (const product of products) product.watermark = watermark;

    return {
      products,
      quality: { acceptedRecords: points.length + summaries.length, rejectedRecords },
    };
  }
}

function parseDocument(value: JsonValue | undefined): RenCollectionDocument {
  if (!isJsonObject(value) || !isJsonString(value.service) || !Array.isArray(value.days)) {
    throw new Error("REN collection must contain a service and days array");
  }
  const config = validateRenFeedConfig({ service: value.service });
  // SAFETY: the feed config was validated by this Gatekeeper, so `service`
  // names one of the services REN_SERVICES declares.
  const service = config.service as RenServiceName;
  const days = value.days.map((entry) => {
    if (!isJsonObject(entry) || !isJsonString(entry.day) || !/^\d{4}-\d{2}-\d{2}$/.test(entry.day) || !isJsonObject(entry.response)) {
      throw new Error("REN collection contains an invalid day response");
    }
    return { day: entry.day, response: entry.response };
  });
  if (days.length === 0) throw new Error("REN collection contains no days");
  return { service, days };
}

/** A REN chart response, reduced to the axis, unit, and series it carries. */
interface RenChart {
  categories: JsonValue[];
  unit: string;
  series: JsonValue[];
}

function parseChart(response: JsonObject): RenChart {
  if (!isJsonObject(response.xAxis) || !Array.isArray(response.xAxis.categories) || !isJsonObject(response.yAxis) || !Array.isArray(response.series)) {
    throw new Error("REN response is not a supported time-axis chart");
  }
  const unit = isJsonObject(response.yAxis.title) && isJsonString(response.yAxis.title.text) ? response.yAxis.title.text.trim() : "";
  return {
    categories: response.xAxis.categories,
    unit,
    series: response.series,
  };
}

function categoryEventTimes(day: string, categories: JsonValue[], gasDayStartHour: number | undefined): Array<string | undefined> {
  const occurrences = new Map<string, number>();
  return categories.map((category) => {
    if (!isJsonString(category) || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(category)) {
      return undefined;
    }
    const hour = Number(category.slice(0, 2));
    const effectiveDay = gasDayStartHour !== undefined && hour < gasDayStartHour ? addDays(day, 1) : day;
    const occurrenceKey = `${effectiveDay}|${category}`;
    const occurrence = occurrences.get(occurrenceKey) ?? 0;
    occurrences.set(occurrenceKey, occurrence + 1);
    return lisbonInstants(effectiveDay, category)[occurrence]?.toISOString();
  });
}

function energyMWh(values: Array<number | null>, unit: string, intervalMinutes: number): number | null {
  const numeric = values.filter((value): value is number => value !== null);
  if (numeric.length === 0) return null;
  const total = numeric.reduce((sum, value) => sum + value, 0);
  if (unit === "MW") return round(total * (intervalMinutes / 60));
  if (unit === "MWh") return round(total);
  return null;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function seriesSchema(unit: string): CanonicalSchema {
  return {
    fields: [
      field("seriesKey", "identifier", false),
      field("eventTime", "datetime", false),
      field("value", "number", false, unit),
      field("unit", "category", false),
      field("dimensions", "json", false),
    ],
  };
}

function summarySchema(unit: string): CanonicalSchema {
  return {
    fields: [
      field("day", "date", false),
      field("seriesKey", "identifier", false),
      {
        ...field("source", "category", false),
        display: { badge: { colorField: "color" } },
      },
      field("color", "color", true),
      field("unit", "category", false),
      field("sampleCount", "number", false, "observation"),
      field("totalEnergyMWh", "number", true, "MWh"),
      field("minimum", "number", true, unit),
      field("maximum", "number", true, unit),
      field("shareOfConsumption", "number", true, "%"),
    ],
  };
}

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return normalized || "series";
}

function hexColor(value: JsonValue | undefined): string | null {
  return isJsonString(value) && /^#[0-9a-f]{6}$/i.test(value) ? value.toUpperCase() : null;
}

function addDays(day: string, amount: number): string {
  const date = new Date(`${day}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}
