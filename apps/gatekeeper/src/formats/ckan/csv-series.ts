import {
  GatekeeperError,
  field,
  invalidResponse,
  isJsonObject,
  isJsonString,
  parseJson,
  streamCsvRows,
  type JsonValue,
  type NormalizedRow,
  type ProductDeclaration,
  type ProductFinalization,
  type SourceConfig,
  type StreamingTransform,
  type TransformContext,
} from "#/index";

interface Measure {
  field: string;
  unit: string;
}

interface CsvSeriesOptions {
  timeField: string;
  measures: Measure[];
  delimiter: "," | ";";
  decimal: "." | ",";
}

/** Measurements are explicitly named, never inferred from numeric-looking columns. */
export function csvSeriesOptions(config: SourceConfig): CsvSeriesOptions | undefined {
  if (!config.measures) {
    if (config.timeField || config.delimiter || config.decimal) {
      throw new GatekeeperError("CKAN CSV series options require measures", "invalid-config");
    }
    return undefined;
  }
  const timeField = config.timeField?.trim();
  if (!timeField || timeField.length > 200 || config.measures.length > 8_192) {
    throw new GatekeeperError("CKAN series require a bounded timeField and measures mapping", "invalid-config");
  }
  let parsed: JsonValue;
  try {
    parsed = parseJson(config.measures);
  } catch {
    throw new GatekeeperError("CKAN measures must be a JSON object mapping column names to units", "invalid-config");
  }
  if (!isJsonObject(parsed)) throw new GatekeeperError("CKAN measures must be a JSON object", "invalid-config");
  const measures: Measure[] = [];
  for (const [name, unit] of Object.entries(parsed).sort(([a], [b]) => a.localeCompare(b))) {
    if (!name.trim() || name.length > 200 || name === timeField || !isJsonString(unit) || !unit.trim() || unit.length > 80) {
      throw new GatekeeperError("CKAN measures require distinct column names and nonempty units", "invalid-config");
    }
    measures.push({ field: name, unit: unit.trim() });
  }
  if (measures.length === 0 || measures.length > 64) throw new GatekeeperError("CKAN series require 1 to 64 measures", "invalid-config");
  const delimiter = config.delimiter ?? ",";
  const decimal = config.decimal ?? ".";
  if (delimiter !== "," && delimiter !== ";") throw new GatekeeperError("CKAN delimiter must be comma or semicolon", "invalid-config");
  if (decimal !== "." && decimal !== ",") throw new GatekeeperError("CKAN decimal must be dot or comma", "invalid-config");
  return { timeField, measures, delimiter, decimal };
}

/** One CSV observation window, one series product, no duplicate record table. */
export async function transformCkanCsvSeries(body: ReadableStream<Uint8Array>, context: TransformContext, options: CsvSeriesOptions): Promise<StreamingTransform> {
  const iterator = streamCsvRows(body, { delimiter: options.delimiter, maxRowBytes: 256 * 1024 })[Symbol.asyncIterator]();
  const first = await iterator.next();
  if (first.done) throw invalidResponse("CKAN observation CSV omitted its header");
  const header = first.value.map((name) => name.trim());
  if (new Set(header).size !== header.length) {
    await iterator.return?.(undefined);
    throw invalidResponse("CKAN observation CSV has duplicate headers");
  }
  const timeIndex = header.indexOf(options.timeField);
  const measures = options.measures.map((measure) => ({ ...measure, index: header.indexOf(measure.field) }));
  if (timeIndex < 0 || measures.some((measure) => measure.index < 0)) {
    await iterator.return?.(undefined);
    throw invalidResponse("CKAN observation CSV omitted a configured date or measurement column");
  }
  const product: ProductDeclaration = {
    productKey: "observations",
    slug: context.feed.slug.replace(/-feed$/, ""),
    title: context.feed.title,
    description: context.feed.description,
    role: "time-series",
    kind: "series",
    schema: {
      fields: [
        field("seriesKey", "identifier", false),
        field("eventTime", "datetime", false),
        field("value", "number", false),
        field("unit", "string", false),
        field("dimensions", "json", false),
      ],
    },
    updateMode: "source-window",
    completeness: "complete",
  };
  let accepted = 0;
  let rejected = 0;
  let watermark: string | undefined;
  async function* rows(): AsyncGenerator<NormalizedRow> {
    try {
      while (true) {
        const next = await iterator.next();
        if (next.done) return;
        const values = next.value;
        if (values.every((value) => !value.trim())) continue;
        const time = observationTime(values[timeIndex]);
        if (values.length !== header.length || !time) {
          rejected += 1;
          continue;
        }
        for (const measure of measures) {
          const value = measurement(values[measure.index], options.decimal);
          if (value === undefined) {
            rejected += 1;
            continue;
          }
          accepted += 1;
          if (!watermark || time > watermark) watermark = time;
          yield { productKey: product.productKey, point: { seriesKey: measure.field, eventTime: time, value, unit: measure.unit, dimensions: { measure: measure.field } } };
        }
      }
    } finally {
      await iterator.return?.(undefined);
    }
  }
  return {
    products: [product],
    rows: rows(),
    finish: () => {
      const final: ProductFinalization = { productKey: product.productKey };
      if (watermark) final.watermark = watermark;
      if (rejected > 0 || accepted === 0) final.completeness = "partial";
      return { quality: { acceptedRecords: accepted, rejectedRecords: rejected }, products: [final] };
    },
  };
}

/** Require the publisher's timezone; never interpret an ambiguous local hour using the polling clock. */
function observationTime(value: string | undefined): string | undefined {
  if (!value || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())) return undefined;
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds)) return undefined;
  const date = value.trim().slice(0, 10);
  const [year, month, day] = date.split("-").map(Number);
  if (year === undefined || month === undefined || day === undefined || new Date(Date.UTC(year, month - 1, day)).toISOString().slice(0, 10) !== date) return undefined;
  if (Number(value.trim().slice(11, 13)) > 23) return undefined;
  return new Date(milliseconds).toISOString();
}

function measurement(value: string | undefined, decimal: "." | ","): number | undefined {
  const normalized = decimal === "," ? value?.trim().replace(",", ".") : value?.trim();
  if (!normalized || !/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(normalized)) return undefined;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : undefined;
}
