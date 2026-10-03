import {
  field,
  invalidResponse,
  streamCsvRecords,
  type CanonicalSchema,
  type NormalizedRow,
  type ProductDeclaration,
  type SeriesPoint,
  type StreamingTransform,
  type TransformContext,
} from "#/index";
import { validateDataverseFeedConfig } from "./dataverse";

/** The translator's name and version: a change to the series or what they mean is a new version. */
export const DATAVERSE_NORMALIZER = { id: "anacom-stat-indicator", version: "1" } as const;

const PRODUCT_KEY = "series";

/** The columns every indicator file carries besides its breakdowns. */
const GROUP = "GrupoDimensao";
const PERIOD = "Id_Periodo";
const VALUE = "Valor";
/** The group of a row that breaks nothing down: the indicator's total, or each operator's. */
const OVERALL = "*(total geral)*";
/** A breakdown column is `Ds_<name>`; its `Ds_<name>_Ordem` twin only orders the source's own tables. */
const BREAKDOWN_PREFIX = "Ds_";
const ORDER_SUFFIX = "_Ordem";
/**
 * The group an operator belongs to describes the operator, not the series: NOWO has been "Grupo NOWO / Onitelecom",
 * "Sem grupo" and "Grupo DIGI / NOWO" in turn, and is one operator throughout.
 */
const DESCRIPTIVE = new Set(["Grupo_Prestador"]);
/** What a breakdown a row does not split by is: its total. ANACOM writes it as "Total", as "" or as "No associated service". */
const TOTAL = "Total";

/** How one file's columns are read: its breakdowns, and the operator columns it carries when it is a market share. */
interface Layout {
  /** Breakdown name (the column without `Ds_`) and the column it is read from. */
  breakdowns: Array<{ name: string; column: string }>;
  /** Columns that are a dimension of every row: the operator and their group. */
  descriptors: string[];
}

interface Run {
  accepted: number;
  rejected: number;
  watermark: string | undefined;
}

/**
 * One STAT.ANACOM indicator CSV into one series per breakdown and operator, every period the file holds. Each row is
 * one value: its period dates it, the breakdowns its `GrupoDimensao` names (and the operator, in a market-share file)
 * name its series, and every breakdown it does not name is that breakdown's total. A row whose group names a breakdown
 * the file has no column for cannot say what it counts, and is rejected.
 */
export function transformIndicator(body: ReadableStream<Uint8Array>, context: TransformContext): StreamingTransform {
  const { unit } = validateDataverseFeedConfig(context.feed.config);
  const run: Run = { accepted: 0, rejected: 0, watermark: undefined };
  const product: ProductDeclaration = {
    productKey: PRODUCT_KEY,
    slug: context.feed.slug,
    title: context.feed.title,
    description: context.feed.description,
    role: "time-series",
    kind: "series",
    schema: seriesSchema(unit),
    // Each file is the indicator's whole history: a period ANACOM withdraws is withdrawn here too.
    updateMode: "authoritative-snapshot",
    completeness: "complete",
  };
  return {
    products: [product],
    rows: indicatorRows(body, unit, run),
    finish: () => ({
      quality: { acceptedRecords: run.accepted, rejectedRecords: run.rejected },
      products: run.watermark ? [{ productKey: PRODUCT_KEY, watermark: run.watermark }] : [],
    }),
  };
}

function seriesSchema(unit: string): CanonicalSchema {
  return {
    fields: [
      field("seriesKey", "identifier", false, undefined, "Series key"),
      field("eventTime", "datetime", false, undefined, "Period start"),
      field("value", "number", false, unit, "Value"),
      field("unit", "category", false, undefined, "Unit"),
      field("dimensions", "json", false, undefined, "Breakdown"),
    ],
  };
}

async function* indicatorRows(body: ReadableStream<Uint8Array>, unit: string, run: Run): AsyncGenerator<NormalizedRow> {
  const csv = streamCsvRecords(body, { delimiter: "\t" });
  const layout = layoutOf(await csv.header);
  const seen = new Set<string>();
  for await (const record of csv.records) {
    const point = pointOf(record, layout, unit);
    const identity = point ? `${point.seriesKey}\n${point.eventTime}` : undefined;
    if (!point || !identity || seen.has(identity)) {
      run.rejected += 1;
      continue;
    }
    seen.add(identity);
    run.accepted += 1;
    if (run.watermark === undefined || point.eventTime > run.watermark) run.watermark = point.eventTime;
    yield { productKey: PRODUCT_KEY, point };
  }
}

function layoutOf(header: string[]): Layout {
  for (const required of [GROUP, PERIOD, VALUE]) {
    if (!header.includes(required)) throw invalidResponse(`STAT.ANACOM's indicator file has no ${required} column`);
  }
  const layout: Layout = { breakdowns: [], descriptors: [] };
  for (const column of header) {
    if (column === GROUP || column === PERIOD || column === VALUE || column.endsWith(ORDER_SUFFIX)) continue;
    if (column.startsWith(BREAKDOWN_PREFIX)) layout.breakdowns.push({ name: column.slice(BREAKDOWN_PREFIX.length), column });
    else layout.descriptors.push(column);
  }
  return layout;
}

function pointOf(record: Record<string, string>, layout: Layout, unit: string): SeriesPoint | undefined {
  const eventTime = periodStart(record[PERIOD] ?? "");
  const value = parseValue(record[VALUE] ?? "");
  if (eventTime === undefined || value === undefined) return undefined;
  const group = (record[GROUP] ?? "").trim();
  if (group === "") return undefined;
  const named = group === OVERALL ? [] : group.split(";").map((name) => name.trim());
  if (named.some((name) => !layout.breakdowns.some((breakdown) => breakdown.name === name))) return undefined;
  const dimensions: Record<string, string> = {};
  const key: string[] = [];
  for (const { name, column } of layout.breakdowns) {
    if (!named.includes(name)) {
      dimensions[name] = TOTAL;
      continue;
    }
    const category = (record[column] ?? "").trim();
    if (category === "") return undefined;
    dimensions[name] = category;
    key.push(`${name}=${category}`);
  }
  for (const column of layout.descriptors) {
    const category = (record[column] ?? "").trim();
    if (category === "") return undefined;
    dimensions[column] = category;
    if (!DESCRIPTIVE.has(column)) key.push(`${column}=${category}`);
  }
  return { seriesKey: key.join(";") || TOTAL, eventTime, value, unit, dimensions };
}

/** A period as ANACOM writes it, `2026 T2` or `2025`, as the instant it starts (UTC). */
export function periodStart(value: string): string | undefined {
  const quarter = /^(\d{4}) T([1-4])$/.exec(value.trim());
  if (quarter?.[1] && quarter[2]) return `${quarter[1]}-${String((Number(quarter[2]) - 1) * 3 + 1).padStart(2, "0")}-01T00:00:00Z`;
  const year = /^(\d{4})$/.exec(value.trim());
  return year?.[1] ? `${year[1]}-01-01T00:00:00Z` : undefined;
}

/** A value as either file language writes it: `29.2` in English, `29,2` in Portuguese. */
function parseValue(value: string): number | undefined {
  const text = value.trim();
  if (!/^-?\d+(?:[.,]\d+)?(?:[eE][-+]?\d+)?$/.test(text)) return undefined;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? number : undefined;
}
