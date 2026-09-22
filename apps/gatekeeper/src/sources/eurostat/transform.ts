import {
  invalidResponse,
  asObject,
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
}

interface JsonStatDataset {
  label: string;
  ids: string[];
  sizes: number[];
  dimensions: JsonStatDimension[];
  timeId: string;
  geoIds: Set<string>;
  metricIds: Set<string>;
  values: Array<[number, JsonValue]>;
  status: JsonObject | undefined;
}

interface DimensionSelection {
  dimension: JsonStatDimension;
  code: string;
  label: string;
}

interface DecodedCell {
  /** The observation's identity: its varying dimension codes and its reference period. */
  entityKey: string;
  /** Value and status, compared when the source repeats the same observation. */
  signature: string;
  point: SeriesPoint;
  unit: string;
}

// Version 2 publishes the series product only; version 1 also repeated every
// value in an "observations" record product.
const TRANSFORMER = { id: "eurostat-jsonstat-dataset", version: "3" } as const;

export function validateEurostatDatasetStructure(bytes: Uint8Array): void {
  parseDataset(bytes);
}

export function transformEurostatDataset(bytes: Uint8Array, context: TransformContext): TransformResult {
  const dataset = parseDataset(bytes);
  const names = namesFor(dataset.dimensions);
  const constantIds = new Set(dataset.dimensions.filter((dimension) => dimension.id !== dataset.timeId && dimension.codes.length === 1).map((dimension) => dimension.id));
  const constants = dataset.dimensions
    .filter((dimension) => constantIds.has(dimension.id))
    .map((dimension) => {
      const code = dimension.codes[0];
      if (code === undefined) {
        throw invalidResponse(`Eurostat dimension ${dimension.id} had no category`);
      }
      return {
        id: dimension.id,
        label: dimension.name,
        code,
        value: dimension.labels[code] ?? code,
      };
    });

  const cells = new Map<string, DecodedCell>();
  let rejectedRecords = 0;
  let duplicateRecords = 0;
  for (const [flatIndex, rawValue] of dataset.values) {
    const decoded = decodeCell(dataset, flatIndex, rawValue, names, constantIds, context.feed.config.unit);
    if (!decoded) {
      rejectedRecords += 1;
      continue;
    }
    const existing = cells.get(decoded.entityKey);
    if (existing) {
      if (existing.signature === decoded.signature) {
        duplicateRecords += 1;
      } else {
        rejectedRecords += 1;
      }
      continue;
    }
    cells.set(decoded.entityKey, decoded);
  }

  const decodedCells = [...cells.values()].sort((left, right) => left.entityKey.localeCompare(right.entityKey));
  const points = decodedCells.map(({ point }) => point).sort((left, right) => left.eventTime.localeCompare(right.eventTime) || left.seriesKey.localeCompare(right.seriesKey));
  const units = new Set(decodedCells.map(({ unit }) => unit));
  const sharedUnit = units.size === 1 ? decodedCells[0]?.unit : undefined;
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
  const title = context.feed.title || dataset.label || "Eurostat dataset";
  // One product: every value is published once, as a point of its series.
  const products: ProductBuild[] = [
    {
      productKey: "series",
      slug: `${context.feed.slug}-series`,
      title,
      description: `Eurostat values grouped into a series for each non-time dimension combination.${constantsNote}`,
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
    quality: { acceptedRecords: points.length, rejectedRecords },
  };
}

function parseDataset(bytes: Uint8Array): JsonStatDataset {
  let raw: JsonValue;
  try {
    raw = parseJsonBytes(bytes);
  } catch {
    throw invalidResponse("Eurostat artifact was not valid JSON");
  }
  if (
    !isJsonObject(raw) ||
    raw.version !== "2.0" ||
    raw.class !== "dataset" ||
    !Array.isArray(raw.id) ||
    !raw.id.every(nonEmptyString) ||
    !Array.isArray(raw.size) ||
    !raw.size.every(positiveInteger) ||
    raw.id.length !== raw.size.length ||
    !isJsonObject(raw.dimension) ||
    !isJsonObject(raw.value)
  ) {
    throw invalidResponse("Eurostat artifact was not a JSON-stat 2.0 dataset");
  }

  const ids = [...raw.id];
  const sizes = [...raw.size];
  const declared = asObject(raw.dimension) ?? {};
  const dimensions = ids.map((id, index) => parseDimension(id, declared, sizes[index]));
  const role = isJsonObject(raw.role) ? raw.role : undefined;
  const timeIds = roleIds(role?.time, ids);
  const timeId = timeIds[0] ?? (ids.includes("time") ? "time" : undefined);
  if (!timeId) {
    throw invalidResponse("Eurostat dataset did not identify a time dimension");
  }
  const geoIds = new Set(roleIds(role?.geo, ids));
  if (geoIds.size === 0 && ids.includes("geo")) geoIds.add("geo");
  const metricIds = new Set(roleIds(role?.metric, ids));

  const cellCount = sizes.reduce((product, size) => product * size, 1);
  if (!Number.isSafeInteger(cellCount)) {
    throw invalidResponse("Eurostat dataset dimensions were too large to decode");
  }
  const values = indexedValues(raw.value, cellCount, "value");
  const status = raw.status === undefined ? undefined : indexedObject(raw.status, cellCount, "status");
  return {
    label: optionalString(raw.label) ?? "Eurostat dataset",
    ids,
    sizes,
    dimensions,
    timeId,
    geoIds,
    metricIds,
    values,
    status,
  };
}

function parseDimension(id: string, dimensions: JsonObject, expectedSize: number | undefined): JsonStatDimension {
  const raw = dimensions[id];
  if (!isJsonObject(raw) || !isJsonObject(raw.category)) {
    throw invalidResponse(`Eurostat dimension ${id} was malformed`);
  }
  const codes = categoryCodes(raw.category.index);
  if (expectedSize === undefined || codes.length !== expectedSize) {
    throw invalidResponse(`Eurostat dimension ${id} size did not match its categories`);
  }
  const labels = isJsonObject(raw.category.label)
    ? Object.fromEntries(Object.entries(raw.category.label).flatMap(([code, value]) => (isJsonString(value) && value.trim() !== "" ? [[code, value.trim()]] : [])))
    : {};
  return {
    id,
    name: optionalString(raw.label) ?? id,
    codes,
    labels,
  };
}

function categoryCodes(value: JsonValue | undefined): string[] {
  if (Array.isArray(value) && value.every(nonEmptyString)) return [...value];
  if (!isJsonObject(value)) {
    throw invalidResponse("Eurostat dimension category index was malformed");
  }
  const entries = Object.entries(value);
  if (!entries.every(([code, position]) => code.length > 0 && isJsonNumber(position) && Number.isSafeInteger(position) && position >= 0)) {
    throw invalidResponse("Eurostat dimension category positions were malformed");
  }
  entries.sort(([, left], [, right]) => Number(left) - Number(right));
  if (entries.some((entry, index) => entry[1] !== index)) {
    throw invalidResponse("Eurostat dimension category positions were not contiguous");
  }
  return entries.map(([code]) => code);
}

function indexedValues(value: JsonValue | undefined, cellCount: number, name: string): Array<[number, JsonValue]> {
  const object = indexedObject(value, cellCount, name);
  return Object.entries(object)
    .map(([key, entry]): [number, JsonValue] => [Number(key), entry])
    .sort((left, right) => left[0] - right[0]);
}

function indexedObject(value: JsonValue | undefined, cellCount: number, name: string): JsonObject {
  if (!isJsonObject(value)) {
    throw invalidResponse(`Eurostat ${name} was not a sparse object`);
  }
  for (const key of Object.keys(value)) {
    if (!/^\d+$/.test(key)) {
      throw invalidResponse(`Eurostat ${name} contained a non-numeric index`);
    }
    const index = Number(key);
    if (!Number.isSafeInteger(index) || index < 0 || index >= cellCount) {
      throw invalidResponse(`Eurostat ${name} index exceeded the dataset dimensions`);
    }
  }
  return value;
}

function decodeCell(
  dataset: JsonStatDataset,
  flatIndex: number,
  rawValue: JsonValue | undefined,
  names: ReadonlyMap<string, string>,
  constantIds: ReadonlySet<string>,
  statedUnit: string | undefined,
): DecodedCell | undefined {
  if (!isJsonNumber(rawValue) || !Number.isFinite(rawValue)) {
    return undefined;
  }
  const selected = coordinates(flatIndex, dataset.sizes).map((position, index): DimensionSelection | undefined => {
    const dimension = dataset.dimensions[index];
    const code = dimension?.codes[position];
    if (!dimension || code === undefined) return undefined;
    return {
      dimension,
      code,
      label: dimension.labels[code] ?? code,
    };
  });
  if (selected.some((selection) => selection === undefined)) return undefined;
  const selections = selected.filter((selection): selection is DimensionSelection => selection !== undefined);
  const time = selections.find(({ dimension }) => dimension.id === dataset.timeId);
  if (!time) return undefined;
  const date = normalizeEurostatPeriod(time.code);
  if (!date) return undefined;
  const eventTime = `${date}T00:00:00Z`;
  const nonTime = selections.filter(({ dimension }) => dimension.id !== dataset.timeId);
  const varying = nonTime.filter(({ dimension }) => !constantIds.has(dimension.id));
  const dimensions: Record<string, string> = {};
  for (const selection of varying) {
    const name = names.get(selection.dimension.id) ?? selection.dimension.name;
    dimensions[name] = selection.label;
  }
  // A dataset without a unit dimension uses the unit its example states.
  const unit = nonTime.find(({ dimension }) => dimension.id === "unit")?.label ?? statedUnit ?? "unknown";
  const seriesCodes = varying.map(({ code }) => code);
  const entityCodes = [...seriesCodes, time.code];
  return {
    entityKey: entityCodes.join(":"),
    signature: JSON.stringify([rawValue, statusAt(dataset.status, flatIndex)]),
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

function statusAt(status: JsonObject | undefined, index: number): string | null {
  const value = status?.[String(index)];
  return isJsonString(value) && value !== "" ? value : null;
}

export function normalizeEurostatPeriod(value: string): string | undefined {
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (day?.[1] && day[2] && day[3]) {
    const normalized = `${day[1]}-${day[2]}-${day[3]}`;
    return validDate(normalized) ? normalized : undefined;
  }

  const week = /^(\d{4})-W(\d{2})$/.exec(value);
  if (week?.[1] && week[2]) {
    const year = Number(week[1]);
    const weekNumber = Number(week[2]);
    if (weekNumber < 1 || weekNumber > 53) return undefined;
    const januaryFourth = new Date(Date.UTC(year, 0, 4));
    const weekday = (januaryFourth.getUTCDay() + 6) % 7;
    const monday = new Date(Date.UTC(year, 0, 4 - weekday + (weekNumber - 1) * 7));
    const parts = isoWeekParts(monday);
    return parts.year === year && parts.week === weekNumber ? monday.toISOString().slice(0, 10) : undefined;
  }

  const month = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(value);
  if (month?.[1] && month[2]) return `${month[1]}-${month[2]}-01`;

  const quarter = /^(\d{4})-Q([1-4])$/.exec(value);
  if (quarter?.[1] && quarter[2]) {
    const monthNumber = (Number(quarter[2]) - 1) * 3 + 1;
    return `${quarter[1]}-${String(monthNumber).padStart(2, "0")}-01`;
  }

  const year = /^(\d{4})$/.exec(value);
  return year?.[1] ? `${year[1]}-01-01` : undefined;
}

function isoWeekParts(date: Date): IsoWeek {
  const thursday = new Date(date);
  const weekday = (thursday.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() + 3 - weekday);
  const year = thursday.getUTCFullYear();
  const januaryFourth = new Date(Date.UTC(year, 0, 4));
  const januaryWeekday = (januaryFourth.getUTCDay() + 6) % 7;
  const firstThursday = new Date(januaryFourth);
  firstThursday.setUTCDate(januaryFourth.getUTCDate() + 3 - januaryWeekday);
  const week = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604_800_000);
  return { year, week };
}

/** An ISO week: the year that owns it, and its number within that year. */
interface IsoWeek {
  year: number;
  week: number;
}

function validDate(value: string): boolean {
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function roleIds(value: JsonValue | undefined, ids: string[]): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => isJsonString(entry) && ids.includes(entry));
}

function namesFor(dimensions: JsonStatDimension[]): Map<string, string> {
  const result = new Map<string, string>();
  const used = new Set(["time", "value", "status"]);
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
