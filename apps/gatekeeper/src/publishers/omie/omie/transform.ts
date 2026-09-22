import {
  field,
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
} from "#/index";
import { OMIE_SERIES, type OmieSeries } from "./omie";
import { marketPeriodStart, parseMarketDate } from "./market-time";

export { marketPeriodStart } from "./market-time";

const PRICE_SERIES_SCHEMA: CanonicalSchema = {
  fields: [
    field("seriesKey", "identifier", false),
    field("eventTime", "datetime", false),
    field("value", "number", false, "EUR/MWh"),
    field("unit", "category", false),
    field("dimensions", "json", false),
  ],
};

const DAILY_SCHEMA: CanonicalSchema = {
  fields: [
    field("date", "date", false),
    field("portugalMinimumPrice", "number", true, "EUR/MWh"),
    field("portugalMaximumPrice", "number", true, "EUR/MWh"),
    field("portugalMeanPrice", "number", true, "EUR/MWh"),
    field("spainMinimumPrice", "number", true, "EUR/MWh"),
    field("spainMaximumPrice", "number", true, "EUR/MWh"),
    field("spainMeanPrice", "number", true, "EUR/MWh"),
  ],
};

interface CapturedFile {
  date: string;
  filename: string;
  text: string;
}

interface PriceValues {
  PT: number[];
  ES: number[];
}

interface ParsedFile {
  points: SeriesPoint[];
  prices: PriceValues;
  candidateRows: number;
  rejectedRows: number;
}

export class OmieTransformer {
  readonly id = "omie-day-ahead-prices";
  readonly version = "2";

  transform(bytes: Uint8Array, context: TransformContext): TransformResult {
    const root = capturedDocument(bytes);
    const configuredSeries = context.feed.config.series;
    if (!isOmieSeries(configuredSeries)) {
      throw new Error(`Unsupported OMIE series: ${configuredSeries ?? "(missing)"}`);
    }
    if (root.series !== configuredSeries) {
      throw new Error(`OMIE captured series ${root.series} does not match configured series ${configuredSeries}`);
    }

    const files = capturedFiles(root.files, root.series);
    const points: SeriesPoint[] = [];
    const records: CanonicalRecord[] = [];
    let candidateRows = 0;
    let rejectedRows = 0;

    for (const file of files) {
      const parsed = parsePriceFile(file, root.series);
      candidateRows += parsed.candidateRows;
      rejectedRows += parsed.rejectedRows;
      points.push(...parsed.points);
      records.push({
        entityKey: file.date,
        eventTime: marketPeriodStart(file.date, 1),
        payload: {
          date: file.date,
          portugalMinimumPrice: minimum(parsed.prices.PT),
          portugalMaximumPrice: maximum(parsed.prices.PT),
          portugalMeanPrice: mean(parsed.prices.PT),
          spainMinimumPrice: minimum(parsed.prices.ES),
          spainMaximumPrice: maximum(parsed.prices.ES),
          spainMeanPrice: mean(parsed.prices.ES),
        },
      });
    }

    points.sort((left, right) => left.eventTime.localeCompare(right.eventTime) || left.seriesKey.localeCompare(right.seriesKey));
    records.sort((left, right) => left.entityKey.localeCompare(right.entityKey));
    if (points.length === 0) {
      throw new Error("OMIE captured document contains no valid price rows");
    }
    const watermark = points.at(-1)!.eventTime;
    const productBase = context.feed.slug.replace(/-feed$/, "");
    const products: ProductBuild[] = [
      {
        productKey: "prices",
        slug: `${productBase}-prices`,
        title: `OMIE ${seriesLabel(root.series)} day-ahead prices`,
        description: "Hourly through 2025-09-30 and quarter-hourly from 2025-10-01: day-ahead electricity prices for Portugal and Spain.",
        role: "time-series",
        schema: PRICE_SERIES_SCHEMA,
        points,
        kind: "series",
        updateMode: "delta",
        completeness: "complete",
        watermark,
      },
      {
        productKey: "daily-summary",
        slug: `${productBase}-daily`,
        title: `OMIE ${seriesLabel(root.series)} daily price summary`,
        description: "Daily minimum, maximum, and arithmetic mean day-ahead prices for Portugal and Spain.",
        role: "reference",
        schema: DAILY_SCHEMA,
        records,
        kind: "record",
        updateMode: "authoritative-snapshot",
        completeness: "complete",
        watermark,
      },
    ];

    return {
      transformer: { id: this.id, version: this.version },
      products,
      quality: { acceptedRecords: points.length + records.length, rejectedRecords: rejectedRows },
    };
  }
}

function capturedDocument(bytes: Uint8Array): JsonObject & {
  series: OmieSeries;
} {
  let value: JsonValue;
  try {
    value = parseJsonBytes(bytes);
  } catch {
    throw new Error("OMIE captured document must be valid JSON");
  }
  if (!isJsonObject(value) || !isOmieSeries(value.series) || !Array.isArray(value.files)) {
    throw new Error("OMIE captured document requires a supported series and files");
  }
  // SAFETY: the checks above confirm `series` names a supported OMIE series
  // and that the document carries the file list alongside it.
  return value as JsonObject & { series: OmieSeries };
}

function capturedFiles(value: JsonValue | undefined, series: OmieSeries): CapturedFile[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error("OMIE captured document requires at least one file");
  }
  const files: CapturedFile[] = [];
  for (const item of value) {
    if (!isJsonObject(item)) throw new Error("OMIE captured file must be an object");
    const date = isJsonString(item.date) ? item.date : "";
    const filename = isJsonString(item.filename) ? item.filename : "";
    const text = isJsonString(item.text) ? item.text : undefined;
    if (!parseMarketDate(date) || (filename !== `${series}_${date.replaceAll("-", "")}.1` && filename !== legacyReportFilename(date)) || text === undefined) {
      throw new Error("OMIE captured file has invalid date, filename, or text");
    }
    files.push({ date, filename, text });
  }
  return files.sort((left, right) => left.date.localeCompare(right.date));
}

function legacyReportFilename(date: string): string {
  const [year, month, day] = date.split("-");
  return `INT_PBC_EV_H_1_${day}_${month}_${year}_${day}_${month}_${year}.TXT`;
}

function parsePriceFile(file: CapturedFile, series: OmieSeries): ParsedFile {
  const lines = file.text.split(/\r?\n/u).map((line) => line.trim());
  if (lines[0] !== `${series.toUpperCase()};`) {
    return parseLegacyPriceReport(file, lines);
  }

  const points: SeriesPoint[] = [];
  const prices: PriceValues = { PT: [], ES: [] };
  let candidateRows = 0;
  let rejectedRows = 0;
  for (const line of lines.slice(1)) {
    if (line === "" || line === "*") continue;
    candidateRows += 1;
    const columns = line.split(";");
    const year = integer(columns[0]);
    const month = integer(columns[1]);
    const day = integer(columns[2]);
    const period = integer(columns[3]);
    const rowDate =
      year === null || month === null || day === null ? undefined : `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    if (rowDate !== file.date || period === null) {
      rejectedRows += 1;
      continue;
    }

    let eventTime: string;
    try {
      eventTime = marketPeriodStart(file.date, period);
    } catch {
      rejectedRows += 1;
      continue;
    }
    // OMIE's published format defines column 5 as Portugal and column 6 as Spain.
    const portugal = price(columns[4]);
    const spain = price(columns[5]);
    if (portugal === null && spain === null) {
      rejectedRows += 1;
      continue;
    }
    if (portugal !== null) {
      prices.PT.push(portugal);
      points.push(point("PT", "Portugal", eventTime, portugal));
    }
    if (spain !== null) {
      prices.ES.push(spain);
      points.push(point("ES", "Spain", eventTime, spain));
    }
  }
  if (points.length === 0) {
    throw new Error(`${file.filename} contains no valid OMIE price rows`);
  }
  return { points, prices, candidateRows, rejectedRows };
}

function parseLegacyPriceReport(file: CapturedFile, lines: string[]): ParsedFile {
  const periodHeader = lines.findIndex((line) => line.startsWith(";"));
  const priceLines = lines
    .slice(periodHeader + 1)
    .filter((line) => line !== "")
    .slice(0, 2);
  if (periodHeader < 0 || priceLines.length !== 2 || priceLines.some((line) => !line.toLocaleLowerCase("es").startsWith("precio marginal"))) {
    throw new Error(`${file.filename} has an invalid OMIE legacy price report`);
  }

  const header = lines[0] ?? "";
  const [year, month, day] = file.date.split("-");
  if (!header.includes(`;${day}/${month}/${year};`) && !header.includes(`;${file.date};`)) {
    throw new Error(`${file.filename} does not contain its captured date`);
  }
  const multiplier = /cent\/kwh/iu.test(header) ? 10 : 1;
  const prices: PriceValues = {
    ES: legacyPrices(priceLines[0]!, multiplier),
    PT: legacyPrices(priceLines[1]!, multiplier),
  };
  const points: SeriesPoint[] = [];
  let candidateRows = 0;
  let rejectedRows = 0;
  for (const [seriesKey, country] of [
    ["PT", "Portugal"],
    ["ES", "Spain"],
  ] as const) {
    for (const [index, value] of prices[seriesKey].entries()) {
      candidateRows += 1;
      try {
        points.push(point(seriesKey, country, marketPeriodStart(file.date, index + 1), value));
      } catch {
        rejectedRows += 1;
      }
    }
  }
  if (points.length === 0) {
    throw new Error(`${file.filename} contains no valid OMIE price rows`);
  }
  return { points, prices, candidateRows, rejectedRows };
}

function legacyPrices(line: string, multiplier: number): number[] {
  return line
    .split(";")
    .slice(1)
    .map((value) => value.trim())
    .filter((value) => value !== "")
    .flatMap((value) => {
      const parsed = Number(value.replaceAll(".", "").replace(",", "."));
      return Number.isFinite(parsed) ? [parsed * multiplier] : [];
    });
}

function point(seriesKey: "PT" | "ES", country: "Portugal" | "Spain", eventTime: string, value: number): SeriesPoint {
  return {
    seriesKey,
    eventTime,
    value,
    unit: "EUR/MWh",
    dimensions: { country, market: "day-ahead" },
  };
}

function integer(value: string | undefined): number | null {
  if (!value || !/^\d+$/u.test(value)) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function price(value: string | undefined): number | null {
  if (value === undefined || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function minimum(values: number[]): number | null {
  return values.length === 0 ? null : Math.min(...values);
}

function maximum(values: number[]): number | null {
  return values.length === 0 ? null : Math.max(...values);
}

function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function seriesLabel(series: OmieSeries): string {
  return series === "marginalpdbc" ? "Spanish file" : "Portuguese file";
}

function isOmieSeries(value: JsonValue | undefined): value is OmieSeries {
  return isJsonString(value) && OMIE_SERIES.some((series) => series === value);
}
