import {
  invalidResponse,
  field,
  isJsonNumber,
  isJsonObject,
  isJsonString,
  parseJsonBytes,
  type JsonObject,
  type JsonValue,
  type ProductBuild,
  type SeriesPoint,
  type TransformContext,
  type TransformResult,
} from "../../index";

interface ParsedRow {
  /** The value's identity: period, geography and dimension codes. */
  entityKey: string;
  point: SeriesPoint;
}

// Version 2 publishes the series product only; version 1 also repeated every
// value in a "values" record product.
const TRANSFORMER = { id: "ine-indicator", version: "3" } as const;

export function transformIneIndicator(bytes: Uint8Array, context: TransformContext): TransformResult {
  const document = parseDocument(bytes);
  const meta = singleIndicator(document.meta, "metadata");
  const data = singleIndicator(document.data, "data");
  const expectedIndicator = context.feed.config.indicator;
  const indicator = requiredString(data.IndicadorCod, "IndicadorCod");
  if (expectedIndicator && indicator !== expectedIndicator) {
    throw invalidResponse(`INE response indicator ${indicator} did not match ${expectedIndicator}`);
  }

  const designation = optionalString(data.IndicadorDsg) ?? optionalString(meta.IndicadorNome) ?? `INE indicator ${indicator}`;
  const title = indicatorTitle(designation);
  const unit = optionalString(meta.UnidadeMedida) ?? "unknown";
  const periodDates = readMetadataPeriodDates(meta);
  const dataByPeriod = data.Dados;
  if (!isJsonObject(dataByPeriod)) {
    throw invalidResponse("INE data response did not contain Dados");
  }

  const dimensionNumbers = collectDimensionNumbers(dataByPeriod);
  const parsedRows: ParsedRow[] = [];
  const entityKeys = new Set<string>();
  let duplicateRows = 0;
  let inputRows = 0;

  for (const [periodLabel, rows] of Object.entries(dataByPeriod)) {
    if (!Array.isArray(rows)) continue;
    inputRows += rows.length;
    const period = normalizePeriod(periodLabel, periodDates);
    if (!period) continue;
    for (const value of rows) {
      const parsed = parseRow(value, period, dimensionNumbers, unit);
      if (!parsed) continue;
      if (entityKeys.has(parsed.entityKey)) {
        duplicateRows += 1;
        continue;
      }
      entityKeys.add(parsed.entityKey);
      parsedRows.push(parsed);
    }
  }

  parsedRows.sort((left, right) => left.entityKey.localeCompare(right.entityKey));
  const points = parsedRows.map(({ point }) => point).sort((left, right) => left.eventTime.localeCompare(right.eventTime) || left.seriesKey.localeCompare(right.seriesKey));
  const rejectedRecords = inputRows - parsedRows.length;

  const seriesSchema = {
    fields: [
      field("seriesKey", "string", false),
      field("eventTime", "datetime", false),
      field("value", "number", false, unit),
      field("unit", "string", false),
      field("dimensions", "json", false),
    ],
  };
  const watermark = points.at(-1)?.eventTime;
  const baseSlug = context.feed.slug;
  // One product: every value is published once, as a point of its series.
  const products: ProductBuild[] = [
    {
      productKey: "series",
      slug: `${baseSlug}-series`,
      title,
      description: `${designation}. Measurements grouped into a series for each geography and dimension combination.`,
      role: "time-series",
      schema: seriesSchema,
      points,
      kind: "series",
      updateMode: "authoritative-snapshot",
      completeness: "complete",
    },
  ];
  if (watermark) for (const product of products) product.watermark = watermark;

  return {
    transformer: TRANSFORMER,
    products,
    quality: { acceptedRecords: parsedRows.length, rejectedRecords },
  };
}

/**
 * An INE designation is a whole sentence: the measure, the dimensions it is
 * broken down by, then the periodicity and the survey behind it — "Dormidas
 * (N.º) nos estabelecimentos de alojamento turístico por Localização
 * geográfica (NUTS - 2024) e Tipo (alojamento turístico); Mensal - INE,
 * Inquérito à permanência de hóspedes na hotelaria e outros alojamentos".
 *
 * A title only wants the measure. Drop the periodicity and survey at the
 * semicolon, and only if what remains is still unreadably long drop the
 * breakdown at "por"/"by" — cutting there unconditionally would turn
 * "Produto interno bruto por habitante" into something it does not mean.
 * Nothing is lost: the full designation becomes the product description.
 */
const TITLE_MAX = 80;

function indicatorTitle(designation: string): string {
  const measure = designation.split(";")[0]?.trim() || designation.trim();
  if (measure.length <= TITLE_MAX) return measure;
  const withoutBreakdown = measure.split(/ (?:por|by) /i)[0]?.trim() ?? "";
  const candidate = withoutBreakdown.length >= 12 ? withoutBreakdown : measure;
  return clipWords(candidate, TITLE_MAX);
}

function clipWords(value: string, max: number): string {
  if (value.length <= max) return value;
  const head = value.slice(0, max);
  const lastSpace = head.lastIndexOf(" ");
  const cut = lastSpace > max * 0.6 ? head.slice(0, lastSpace) : head;
  return `${cut.trimEnd()}…`;
}

function parseDocument(bytes: Uint8Array): JsonObject {
  let parsed: JsonValue;
  try {
    parsed = parseJsonBytes(bytes);
  } catch {
    throw invalidResponse("INE artifact was not valid JSON");
  }
  if (!isJsonObject(parsed)) {
    throw invalidResponse("INE artifact must be a JSON object");
  }
  return parsed;
}

function singleIndicator(value: JsonValue | undefined, resource: string): JsonObject {
  if (!Array.isArray(value) || value.length !== 1 || !isJsonObject(value[0])) {
    throw invalidResponse(`INE ${resource} must contain one indicator`);
  }
  return value[0];
}

function readMetadataPeriodDates(meta: JsonObject): ReadonlyMap<string, string> {
  const periods = new Map<string, string>();
  if (!isJsonObject(meta.Dimensoes) || !Array.isArray(meta.Dimensoes.Categoria_Dim)) {
    return periods;
  }
  for (const group of meta.Dimensoes.Categoria_Dim) {
    if (!isJsonObject(group)) continue;
    for (const categories of Object.values(group)) {
      if (!Array.isArray(categories)) continue;
      for (const value of categories) {
        if (!isJsonObject(value) || String(value.dim_num) !== "1") continue;
        const label = optionalString(value.categ_dsg);
        const order = optionalString(value.categ_ord);
        const date = order ? dateFromOrder(order) : undefined;
        if (label && date) periods.set(normalizeLabel(label), date);
      }
    }
  }
  return periods;
}

function collectDimensionNumbers(dataByPeriod: JsonObject): number[] {
  const numbers = new Set<number>();
  for (const rows of Object.values(dataByPeriod)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!isJsonObject(row)) continue;
      for (const key of Object.keys(row)) {
        const match = /^dim_(\d+)$/.exec(key);
        if (match?.[1]) numbers.add(Number(match[1]));
      }
    }
  }
  return [...numbers].sort((left, right) => left - right);
}

function parseRow(value: JsonValue | undefined, period: string, dimensionNumbers: number[], unit: string): ParsedRow | undefined {
  if (!isJsonObject(value)) return undefined;
  const geocod = optionalString(value.geocod);
  const geodsg = optionalString(value.geodsg);
  const numericValue = parseNumber(value.valor);
  if (!geocod || !geodsg || numericValue === undefined) return undefined;

  const dimensionCodes: string[] = [];
  const dimensions: SeriesPoint["dimensions"] = { geography: geodsg };
  for (const number of dimensionNumbers) {
    const codeKey = `dim_${number}`;
    const code = optionalString(value[codeKey]);
    if (!code) return undefined;
    const label = optionalString(value[`${codeKey}_t`]);
    dimensionCodes.push(code);
    dimensions[codeKey] = label ?? code;
  }

  const eventTime = `${period}T00:00:00.000Z`;
  return {
    entityKey: [period, geocod, ...dimensionCodes].join(":"),
    point: {
      seriesKey: [geocod, ...dimensionCodes].join(":"),
      eventTime,
      value: numericValue,
      unit,
      dimensions,
    },
  };
}

function normalizePeriod(label: string, metadataDates: ReadonlyMap<string, string>): string | undefined {
  const trimmed = label.trim();
  const metadataDate = metadataDates.get(normalizeLabel(trimmed));
  if (metadataDate) return metadataDate;

  const year = /^(\d{4})$/.exec(trimmed);
  if (year?.[1]) return `${year[1]}-01-01`;
  const separatedMonth = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(trimmed);
  if (separatedMonth?.[1] && separatedMonth[2]) {
    return `${separatedMonth[1]}-${separatedMonth[2]}-01`;
  }
  const compactMonth = /^(\d{4})(0[1-9]|1[0-2])$/.exec(trimmed);
  if (compactMonth?.[1] && compactMonth[2]) {
    return `${compactMonth[1]}-${compactMonth[2]}-01`;
  }

  const localizedMonth = /^([^\d]+?)\s+(?:de\s+)?(\d{4})$/i.exec(trimmed);
  if (localizedMonth?.[1] && localizedMonth[2]) {
    const month = MONTHS.get(normalizeLabel(localizedMonth[1]));
    if (month) return `${localizedMonth[2]}-${month}-01`;
  }
  return undefined;
}

function dateFromOrder(value: string): string | undefined {
  const match = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (!match?.[1] || !match[2] || !match[3]) return undefined;
  const date = `${match[1]}-${match[2]}-${match[3]}`;
  return Number.isNaN(Date.parse(`${date}T00:00:00Z`)) ? undefined : date;
}

function parseNumber(value: JsonValue | undefined): number | undefined {
  if (isJsonNumber(value)) {
    return Number.isFinite(value) ? value : undefined;
  }
  if (!isJsonString(value)) return undefined;
  const normalized = value.trim().replaceAll(" ", "").replace(",", ".");
  if (normalized === "") return undefined;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : undefined;
}

const MONTHS = new Map<string, string>([
  ["janeiro", "01"],
  ["fevereiro", "02"],
  ["marco", "03"],
  ["abril", "04"],
  ["maio", "05"],
  ["junho", "06"],
  ["julho", "07"],
  ["agosto", "08"],
  ["setembro", "09"],
  ["outubro", "10"],
  ["novembro", "11"],
  ["dezembro", "12"],
  ["january", "01"],
  ["february", "02"],
  ["march", "03"],
  ["april", "04"],
  ["may", "05"],
  ["june", "06"],
  ["july", "07"],
  ["august", "08"],
  ["september", "09"],
  ["october", "10"],
  ["november", "11"],
  ["december", "12"],
]);

function normalizeLabel(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim()
    .toLowerCase();
}

function requiredString(value: JsonValue | undefined, fieldName: string): string {
  const result = optionalString(value);
  if (!result) throw invalidResponse(`INE response omitted ${fieldName}`);
  return result;
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" ? value.trim() : undefined;
}
