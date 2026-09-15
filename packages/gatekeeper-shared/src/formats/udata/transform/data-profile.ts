import {
  asArray,
  isJsonArray,
  isJsonObject,
  parseJson,
  readBoundedBytes,
  streamCsvRecords,
  streamJsonArray,
} from "../../../index";
import type { JsonObject, JsonValue } from "../../../index";
import { isUtf8, peekBody, sniffJson, sniffText } from "./body";

export interface DataColumn {
  name: string;
  type: "boolean" | "date" | "number" | "string";
  nullable: boolean;
}

export interface DataProfile {
  rowCount?: number;
  columns: DataColumn[];
  sampleRows: Record<string, string | null>[];
}

/** One page of a delimited body, empty cells read as null. */
export interface CsvPage {
  columns: string[];
  rows: Record<string, string | null>[];
}

const SAMPLE_LIMIT = 50;
const PREFIX_BYTES = 64 * 1024;
/** A single JSON object has no array to stream; it is profiled whole only up to this size. */
const JSON_OBJECT_LIMIT = 5 * 1024 * 1024;
const JSON_ROW_KEYS = ["data", "results", "items", "features"] as const;

/** What every present value of one column could be read as, in bounded counters. */
interface ColumnReadings {
  name: string;
  present: number;
  missing: boolean;
  booleans: number;
  numbers: number;
  dates: number;
}

/**
 * Profile a CSV or JSON body in one pass. The row count and each column's
 * type and nullability come from every row through bounded counters; the
 * samples are the first 50 rows.
 */
export async function profileStream(
  body: ReadableStream<Uint8Array>,
  format: string | undefined,
  mediaType: string,
): Promise<DataProfile> {
  const normalizedFormat = format?.toLowerCase();
  const media = mediaType.toLowerCase();
  if (normalizedFormat === "csv" || media.includes("text/csv")) {
    const csv = streamCsvRecords(body);
    return profileRows(await csv.header, csvRows(csv.records));
  }
  if (normalizedFormat === "json" || media.includes("json")) {
    try {
      return await profileJson(body);
    } catch {
      return { columns: [], sampleRows: [] };
    }
  }
  await body.cancel("Only CSV and JSON bodies are profiled").catch(() => undefined);
  return { columns: [], sampleRows: [] };
}

export async function readCsvPage(
  body: ReadableStream<Uint8Array>,
  offset: number,
  limit: number,
): Promise<CsvPage> {
  const csv = streamCsvRecords(body);
  const columns = await csv.header;
  const rows: Record<string, string | null>[] = [];
  if (limit <= 0) return { columns, rows };
  let index = 0;
  for await (const record of csv.records) {
    if (index >= offset) rows.push(nullableRow(record));
    index += 1;
    if (rows.length >= limit) break;
  }
  return { columns, rows };
}

async function* csvRows(records: AsyncIterable<Record<string, string>>): AsyncGenerator<Record<string, string | null>> {
  for await (const record of records) yield nullableRow(record);
}

async function profileJson(body: ReadableStream<Uint8Array>): Promise<DataProfile> {
  const peeked = await peekBody(body, PREFIX_BYTES);
  const sniff = isUtf8(peeked.prefix, peeked.complete) ? sniffJson(sniffText(peeked.prefix, true)) : undefined;
  const key = sniff?.root === "object" ? JSON_ROW_KEYS.find((candidate) => sniff.arrays.includes(candidate)) : undefined;
  if (sniff?.root === "array" || key !== undefined) {
    const stream = streamJsonArray(peeked.body, key === undefined ? [] : [key]);
    return profileRows([], jsonRows(stream.elements));
  }
  const value = parseJson(new TextDecoder().decode(await readBoundedBytes(peeked.body, JSON_OBJECT_LIMIT)));
  return profileRows([], jsonRows(listRecords(value)));
}

async function* jsonRows(values: AsyncIterable<JsonValue> | Iterable<JsonValue>): AsyncGenerator<Record<string, string | null>> {
  for await (const value of values) {
    if (isJsonObject(value)) yield jsonRecordToRow(value);
  }
}

async function profileRows(
  header: string[],
  rows: AsyncIterable<Record<string, string | null>>,
): Promise<DataProfile> {
  const readings = new Map<string, ColumnReadings>();
  const reading = (name: string): ColumnReadings => {
    let found = readings.get(name);
    if (!found) {
      found = { name, present: 0, missing: false, booleans: 0, numbers: 0, dates: 0 };
      readings.set(name, found);
    }
    return found;
  };
  for (const name of header) reading(name);
  const sampleRows: Record<string, string | null>[] = [];
  let rowCount = 0;
  for await (const row of rows) {
    if (Object.values(row).every((value) => value === null || value.trim() === "")) continue;
    rowCount += 1;
    if (sampleRows.length < SAMPLE_LIMIT) sampleRows.push(row);
    for (const name of Object.keys(row)) reading(name);
    for (const column of readings.values()) {
      const value = row[column.name] ?? null;
      if (value === null) {
        column.missing = true;
        continue;
      }
      column.present += 1;
      if (/^(true|false)$/i.test(value)) column.booleans += 1;
      const numeric = value.trim().replace(",", ".");
      if (numeric !== "" && Number.isFinite(Number(numeric))) column.numbers += 1;
      if (/^\d{4}-\d{2}-\d{2}(?:[T ]|$)/.test(value) && !Number.isNaN(Date.parse(value))) column.dates += 1;
    }
  }
  return {
    rowCount,
    columns: [...readings.values()].map((column) => ({
      name: column.name,
      type: column.present === 0
        ? "string"
        : column.booleans === column.present
          ? "boolean"
          : column.numbers === column.present
            ? "number"
            : column.dates === column.present ? "date" : "string",
      nullable: column.missing,
    })),
    sampleRows,
  };
}

function nullableRow(record: Record<string, string>): Record<string, string | null> {
  return Object.fromEntries(Object.entries(record).map(([key, value]) => [key, value === "" ? null : value]));
}

function listRecords(value: JsonValue): JsonValue[] {
  if (isJsonArray(value)) return value;
  if (isJsonObject(value)) {
    for (const key of JSON_ROW_KEYS) {
      const nested = asArray(value[key]);
      if (nested !== undefined) return nested;
    }
    return [value];
  }
  return [];
}

function jsonRecordToRow(
  record: JsonObject,
): Record<string, string | null> {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      key,
      value === null
        ? null
        : isJsonObject(value) || isJsonArray(value)
          ? JSON.stringify(value)
          : String(value),
    ]),
  );
}
