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

interface JsonStatDimension {
  id: string;
  name: string;
  codes: string[];
  labels: Record<string, string>;
  units: JsonObject;
}

interface JsonStatPage {
  raw: JsonObject;
  label: string;
  ids: string[];
  sizes: number[];
  dimensions: JsonStatDimension[];
  timeId: string;
  values: Array<[number, JsonValue]>;
  status: JsonValue;
}

interface DecodedCell {
  /** The observation's identity: its varying dimension codes and its reference date. */
  entityKey: string;
  /** Value and status, compared when a later page repeats the same observation. */
  signature: string;
  point: SeriesPoint;
  unit: string;
}

// Version 2 publishes the series product only; version 1 also repeated every
// value in an "observations" record product.
const TRANSFORMER = { id: "bpstat-jsonstat-dataset", version: "4" } as const;

export function transformBpstatDataset(bytes: Uint8Array, context: TransformContext): TransformResult {
  const pages = parseArtifact(bytes).map(parsePage);
  if (pages.length === 0) {
    throw invalidResponse("BPstat artifact did not contain a dataset page");
  }

  const first = pages[0];
  if (!first) throw invalidResponse("BPstat artifact did not contain a dataset");
  for (const page of pages.slice(1)) {
    if (page.ids.length !== first.ids.length || page.ids.some((id, index) => id !== first.ids[index]) || page.timeId !== first.timeId) {
      throw invalidResponse("BPstat dataset pages used inconsistent dimensions");
    }
  }

  const dimensionNames = namesFor(first.dimensions);
  // A dimension with one category across the dataset (its source, periodicity,
  // unit, territory...) is a fact about the product, not about each row.
  // Repeating it per observation made a 100 KB page into 10 MB of products.
  // BPstat pages are not slices of one table: each page carries a different
  // set of series, so a dimension with one category on the first page may
  // have two on a later page. Decide what is constant across every page.
  const codesById = new Map<string, Set<string>>();
  for (const page of pages) {
    for (const dimension of page.dimensions) {
      const codes = codesById.get(dimension.id) ?? new Set<string>();
      for (const code of dimension.codes) codes.add(code);
      codesById.set(dimension.id, codes);
    }
  }
  const constantIds = new Set(
    first.dimensions.filter((dimension) => dimension.id !== first.timeId && (codesById.get(dimension.id)?.size ?? 0) === 1).map((dimension) => dimension.id),
  );
  const constants = first.dimensions
    .filter((dimension) => constantIds.has(dimension.id))
    .map((dimension) => ({
      id: dimension.id,
      label: dimensionNames.get(dimension.id) ?? dimension.name,
      code: dimension.codes[0]!,
      value: dimension.labels[dimension.codes[0]!] ?? dimension.codes[0]!,
    }));
  const cellsByEntity = new Map<string, DecodedCell>();
  let nonNullValues = 0;
  let duplicateObservations = 0;
  let conflictingObservations = 0;
  let rejectedRecords = 0;

  for (const page of pages) {
    for (const [flatIndex, rawValue] of page.values) {
      if (rawValue === null || rawValue === undefined) continue;
      nonNullValues += 1;
      const decoded = decodeCell(page, flatIndex, rawValue, dimensionNames, constantIds);
      if (!decoded) {
        rejectedRecords += 1;
        continue;
      }
      const existing = cellsByEntity.get(decoded.entityKey);
      if (existing) {
        if (existing.signature === decoded.signature) {
          duplicateObservations += 1;
        } else {
          conflictingObservations += 1;
          rejectedRecords += 1;
        }
        continue;
      }
      cellsByEntity.set(decoded.entityKey, decoded);
    }
  }

  const cells = [...cellsByEntity.values()].sort((left, right) => left.entityKey.localeCompare(right.entityKey));

  const points = cells.map(({ point }) => point).sort((left, right) => left.eventTime.localeCompare(right.eventTime) || left.seriesKey.localeCompare(right.seriesKey));
  if (context.feed.config.lastN) {
    const counts = new Map<string, number>();
    for (const point of points) counts.set(point.seriesKey, (counts.get(point.seriesKey) ?? 0) + 1);
    if ([...counts.values()].some((count) => count > Number(context.feed.config.lastN))) throw invalidResponse("BPstat exceeded the requested latest-observation window");
  }
  const units = new Set(cells.map(({ unit }) => unit));
  const sharedUnit = units.size === 1 ? cells[0]?.unit : undefined;
  const constantsNote = constants.length === 0 ? "" : ` Fixed for this dataset: ${constants.map((constant) => `${constant.label}: ${constant.value}`).join("; ")}.`;
  const seriesSchema = {
    fields: [
      field("seriesKey", "identifier", false, undefined, "Series key"),
      field("eventTime", "datetime", false, undefined, "Reference time"),
      field("value", "number", false, sharedUnit, "Value"),
      field("unit", "category", false, undefined, "Unit"),
      field("dimensions", "json", false, undefined, "Dimensions"),
    ],
  };
  const watermark = points.at(-1)?.eventTime;
  const title = context.feed.title || first.label || "BPstat dataset";
  // One product: every value is published once, as a point of its series.
  const products: ProductBuild[] = [
    {
      productKey: "series",
      slug: `${context.feed.slug}-series`,
      title,
      description: `${context.feed.description} BPstat values grouped into a series for each non-time dimension combination.${constantsNote}`,
      role: "time-series",
      schema: seriesSchema,
      kind: "series",
      points,
      updateMode: context.feed.config.lastN ? "source-window" : "authoritative-snapshot",
      completeness: "complete",
    },
  ];
  if (watermark) for (const product of products) product.watermark = watermark;

  return {
    transformer: TRANSFORMER,
    products,
    quality: { acceptedRecords: points.length, rejectedRecords },
  };
}

function parseArtifact(bytes: Uint8Array): JsonObject[] {
  let parsed: JsonValue;
  try {
    parsed = parseJsonBytes(bytes);
  } catch {
    throw invalidResponse("BPstat artifact was not valid JSON");
  }
  if (!isJsonObject(parsed)) {
    throw invalidResponse("BPstat artifact must be a JSON object");
  }
  if (Array.isArray(parsed.pages)) {
    if (!parsed.pages.every(isJsonObject)) {
      throw invalidResponse("BPstat paginated artifact contained an invalid page");
    }
    return parsed.pages;
  }
  return [parsed];
}

function parsePage(raw: JsonObject): JsonStatPage {
  if (
    raw.version !== "2.0" ||
    raw.class !== "dataset" ||
    !Array.isArray(raw.id) ||
    !raw.id.every(nonEmptyString) ||
    !Array.isArray(raw.size) ||
    !raw.size.every(positiveInteger) ||
    raw.id.length !== raw.size.length ||
    !isJsonObject(raw.dimension) ||
    (!Array.isArray(raw.value) && !isJsonObject(raw.value))
  ) {
    throw invalidResponse("BPstat page was not a JSON-stat 2.0 dataset");
  }

  const ids = [...raw.id];
  const sizes = [...raw.size];
  const dimensionMap = raw.dimension;
  const dimensions = ids.map((id, index) => parseDimension(id, dimensionMap, sizes[index]));
  const role = isJsonObject(raw.role) ? raw.role : undefined;
  const timeRole = role && Array.isArray(role.time) ? role.time.filter(nonEmptyString) : [];
  const timeId = timeRole[0] ?? (ids.includes("reference_date") ? "reference_date" : undefined);
  if (!timeId || !ids.includes(timeId)) {
    throw invalidResponse("BPstat dataset did not identify a time dimension");
  }

  const cellCount = sizes.reduce((product, size) => product * size, 1);
  if (!Number.isSafeInteger(cellCount)) {
    throw invalidResponse("BPstat dataset dimensions were too large to decode");
  }
  const values = indexedValues(raw.value, cellCount, "value");
  if (raw.status !== undefined) {
    indexedValues(raw.status, cellCount, "status");
  }
  return {
    raw,
    label: optionalString(raw.label) ?? "BPstat dataset",
    ids,
    sizes,
    dimensions,
    timeId,
    values,
    status: raw.status ?? null,
  };
}

function parseDimension(id: string, dimensions: JsonObject, expectedSize: number | undefined): JsonStatDimension {
  const raw = dimensions[id];
  if (!isJsonObject(raw) || !isJsonObject(raw.category)) {
    throw invalidResponse(`BPstat dimension ${id} was malformed`);
  }
  const codes = categoryCodes(raw.category.index);
  if (expectedSize === undefined || codes.length !== expectedSize) {
    throw invalidResponse(`BPstat dimension ${id} size did not match its categories`);
  }
  const labels = isJsonObject(raw.category.label)
    ? Object.fromEntries(Object.entries(raw.category.label).flatMap(([code, value]) => (isJsonString(value) && value.trim() !== "" ? [[code, value.trim()]] : [])))
    : {};
  return {
    id,
    name: optionalString(raw.label) ?? id,
    codes,
    labels,
    units: isJsonObject(raw.category.unit) ? raw.category.unit : {},
  };
}

function categoryCodes(value: JsonValue | undefined): string[] {
  if (Array.isArray(value) && value.every(nonEmptyString)) return [...value];
  if (!isJsonObject(value)) {
    throw invalidResponse("BPstat dimension category index was malformed");
  }
  const entries = Object.entries(value);
  if (!entries.every(([, position]) => isJsonNumber(position) && Number.isSafeInteger(position) && position >= 0)) {
    throw invalidResponse("BPstat dimension category positions were malformed");
  }
  entries.sort(([, left], [, right]) => Number(left) - Number(right));
  if (entries.some((entry, index) => entry[1] !== index)) {
    throw invalidResponse("BPstat dimension category positions were not contiguous");
  }
  return entries.map(([code]) => code);
}

function indexedValues(value: JsonValue | undefined, cellCount: number, name: string): Array<[number, JsonValue]> {
  if (Array.isArray(value)) {
    if (value.length > cellCount) {
      throw invalidResponse(`BPstat ${name} exceeded the dataset dimensions`);
    }
    return value.map((entry, index) => [index, entry]);
  }
  if (!isJsonObject(value)) {
    throw invalidResponse(`BPstat ${name} was neither dense nor sparse`);
  }
  const result: Array<[number, JsonValue]> = [];
  for (const [key, entry] of Object.entries(value)) {
    if (!/^\d+$/.test(key)) {
      throw invalidResponse(`BPstat ${name} contained a non-numeric index`);
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= cellCount) {
      throw invalidResponse(`BPstat ${name} index exceeded the dataset dimensions`);
    }
    result.push([index, entry]);
  }
  result.sort((left, right) => left[0] - right[0]);
  return result;
}

function decodeCell(
  page: JsonStatPage,
  flatIndex: number,
  rawValue: JsonValue | undefined,
  names: ReadonlyMap<string, string>,
  constantIds: ReadonlySet<string>,
): DecodedCell | undefined {
  if (!isJsonNumber(rawValue) || !Number.isFinite(rawValue)) {
    return undefined;
  }
  const selections = coordinates(flatIndex, page.sizes).map((position, index) => {
    const dimension = page.dimensions[index];
    const code = dimension?.codes[position];
    if (!dimension || code === undefined) return undefined;
    return {
      dimension,
      code,
      label: dimension.labels[code] ?? code,
    };
  });
  if (selections.some((selection) => selection === undefined)) return undefined;
  const selected = selections.filter((selection): selection is NonNullable<typeof selection> => selection !== undefined);
  const time = selected.find(({ dimension }) => dimension.id === page.timeId);
  if (!time) return undefined;
  const date = normalizeReferenceDate(time.code);
  if (!date) return undefined;
  const eventTime = `${date}T00:00:00Z`;
  const nonTime = selected.filter(({ dimension }) => dimension.id !== page.timeId);
  const varying = nonTime.filter(({ dimension }) => !constantIds.has(dimension.id));
  const dimensions: Record<string, string> = {};
  for (const selection of varying) {
    const name = names.get(selection.dimension.id) ?? selection.dimension.name;
    dimensions[name] = selection.label;
  }
  const unit = unitFor(nonTime);
  const allCodes = [...varying.map(({ code }) => code), time.code];
  const seriesCodes = varying.map(({ code }) => code);
  return {
    entityKey: allCodes.join(":"),
    signature: JSON.stringify([rawValue, statusAt(page.status, flatIndex)]),
    point: {
      seriesKey: seriesCodes.join(":") || "all",
      eventTime,
      value: rawValue,
      unit,
      dimensions,
    },
    unit,
  };
}

function coordinates(flatIndex: number, sizes: number[]): number[] {
  const result = Array.from<number>({ length: sizes.length });
  let remainder = flatIndex;
  for (let index = sizes.length - 1; index >= 0; index -= 1) {
    const size = sizes[index];
    if (size === undefined) return [];
    result[index] = remainder % size;
    remainder = Math.floor(remainder / size);
  }
  return result;
}

function unitFor(
  selections: Array<{
    dimension: JsonStatDimension;
    code: string;
    label: string;
  }>,
): string {
  for (const { dimension, code } of selections) {
    const unit = unitLabel(dimension.units[code]);
    if (unit) return unit;
  }
  const unitDimension = selections.find(({ dimension }) => /(^|\b)unit(\b|$)|unidade/i.test(dimension.name));
  return unitDimension?.label ?? "unknown";
}

function unitLabel(value: JsonValue | undefined): string | undefined {
  if (isJsonString(value) && value.trim() !== "") return value.trim();
  if (!isJsonObject(value)) return undefined;
  return optionalString(value.label) ?? optionalString(value.symbol) ?? optionalString(value.name);
}

function statusAt(status: JsonValue | undefined, index: number): string | null {
  const value = Array.isArray(status) ? status[index] : isJsonObject(status) ? status[String(index)] : undefined;
  if (isJsonString(value) && value !== "") return value;
  return null;
}

export function normalizeReferenceDate(value: string): string | undefined {
  const date = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (date?.[1] && date[2] && date[3]) {
    const normalized = `${date[1]}-${date[2]}-${date[3]}`;
    return validDate(normalized) ? normalized : undefined;
  }

  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (month?.[1] && month[2]) {
    return endOfMonth(Number(month[1]), Number(month[2]));
  }

  const quarter = /^(\d{4})-?[QT]([1-4])$/i.exec(value);
  if (quarter?.[1] && quarter[2]) {
    return endOfMonth(Number(quarter[1]), Number(quarter[2]) * 3);
  }

  const semester = /^(\d{4})-?S([12])$/i.exec(value);
  if (semester?.[1] && semester[2]) {
    return endOfMonth(Number(semester[1]), Number(semester[2]) * 6);
  }

  const year = /^(\d{4})$/.exec(value);
  return year?.[1] ? `${year[1]}-12-31` : undefined;
}

function endOfMonth(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function namesFor(dimensions: JsonStatDimension[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set<string>(["time", "value", "status"]);
  for (const dimension of dimensions) {
    let name = dimension.name.trim() || dimension.id;
    if (used.has(name)) name = `${name} (${dimension.id})`;
    used.add(name);
    used.add(`${name} code`);
    result.set(dimension.id, name);
  }
  return result;
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" ? value.trim() : undefined;
}

function nonEmptyString(value: JsonValue | undefined): value is string {
  return isJsonString(value) && value.length > 0;
}

function positiveInteger(value: JsonValue | undefined): value is number {
  return isJsonNumber(value) && Number.isSafeInteger(value) && value > 0;
}
