import { NormalizedInputError, isJsonNumber, isJsonObject, isJsonString, type JsonObject, type JsonValue } from "@open-data-pt/contract";

/**
 * The history plane: append-only revision rows written through Cloudflare
 * Pipelines into Iceberg tables in R2 Data Catalog. Pipelines documents
 * exactly-once delivery to R2 once `send()` resolves; revision IDs are stable,
 * so a resend after an ambiguous timeout is deduplicated when history is read.
 */
export type LakeTable = "records" | "points";

export interface LakeSink {
  send(table: LakeTable, rows: JsonObject[]): Promise<void>;
}

/** Minimal shape of a Pipelines stream binding; typed bindings refine it. */
export interface StreamBinding {
  send(records: Array<JsonObject>): Promise<void>;
}

export interface LakeBindings {
  LAKE_RECORDS?: StreamBinding;
  LAKE_POINTS?: StreamBinding;
}

/**
 * The pipeline bindings this Worker holds, seen as the lake's own streams.
 * Each pipeline is typed by the table it feeds; the kernel builds exactly those
 * columns, and this adapter is the one place that says so.
 */
export function lakeStreams(env: Env): LakeBindings {
  const streams: LakeBindings = {};
  if (env.LAKE_RECORDS) {
    const pipeline = env.LAKE_RECORDS;
    // SAFETY: every row sent to LAKE_RECORDS passed validateLakeRow for the records table.
    streams.LAKE_RECORDS = { send: (rows) => pipeline.send(rows as Cloudflare.OpenDataV2RecordsRecord[]) };
  }
  if (env.LAKE_POINTS) {
    const pipeline = env.LAKE_POINTS;
    // SAFETY: every row sent to LAKE_POINTS passed validateLakeRow for the points table.
    streams.LAKE_POINTS = { send: (rows) => pipeline.send(rows as Cloudflare.OpenDataV2PointsRecord[]) };
  }
  return streams;
}

const MAX_SEND_ROWS = 1000;
/**
 * Pipelines refuses a single message over 1 MB ("Individual message must not
 * exceed 1 MB"; the limits page names only the 5 MB request). A record may be up
 * to MAX_RECORD_BYTES and its row carries more around it, so a row is fitted to
 * this, with room for how the binding frames it.
 */
export const LAKE_ROW_BYTES = 900_000;
/** Pipelines accepts at most 5 MB per ingestion request; keep JSON framing overhead below it. */
const MAX_SEND_BYTES = 4_900_000;

export class PipelinesLake implements LakeSink {
  constructor(private readonly bindings: LakeBindings) {}

  static available(bindings: LakeBindings): boolean {
    return Boolean(bindings.LAKE_RECORDS && bindings.LAKE_POINTS);
  }

  async send(table: LakeTable, rows: JsonObject[]): Promise<void> {
    const binding = table === "records" ? this.bindings.LAKE_RECORDS : this.bindings.LAKE_POINTS;
    if (!binding) throw new Error(`Lake stream for ${table} is not bound`);
    const encoder = new TextEncoder();
    let chunk: JsonObject[] = [];
    let bytes = 2;
    const flush = async (): Promise<void> => {
      if (chunk.length === 0) return;
      await withTimeout(binding.send(chunk), 60_000, "Pipeline submission timed out");
      chunk = [];
      bytes = 2;
    };
    for (const original of rows) {
      const row = fitLakeRow(original, table);
      if (!row) continue;
      const rowBytes = encoder.encode(JSON.stringify(row)).byteLength + (chunk.length > 0 ? 1 : 0);
      if (chunk.length >= MAX_SEND_ROWS || bytes + rowBytes > MAX_SEND_BYTES) await flush();
      chunk.push(row);
      bytes += rowBytes;
    }
    await flush();
  }
}

/**
 * A row the lake will take. A record history row over LAKE_ROW_BYTES keeps its
 * revision and every field that fits: its largest payload values (a boundary's
 * geometry, usually) are left out, largest first, and named under `_omitted`
 * with the payload's size, so the history says what it does not hold. A row
 * that still does not fit, whose payload has an `_omitted` of its own, or a
 * point, is left out of the lake altogether: one
 * row the lake refuses must never hold back the rest. Either is logged.
 */
export function fitLakeRow(row: JsonObject, table: LakeTable): JsonObject | undefined {
  const encoder = new TextEncoder();
  const size = (value: JsonValue) => encoder.encode(JSON.stringify(value)).byteLength;
  const bytes = size(row);
  if (bytes <= LAKE_ROW_BYTES) return row;
  const payload = row.payload;
  // A payload with its own `_omitted` has no room to name what was left out without losing that field.
  if (table === "records" && isJsonObject(payload) && !Object.hasOwn(payload, "_omitted")) {
    const fields = Object.entries(payload)
      .map(([name, value]) => ({ name, bytes: size(value ?? null) }))
      .sort((a, b) => b.bytes - a.bytes);
    const kept: JsonObject = { ...payload };
    const omitted: string[] = [];
    let remaining = bytes;
    for (const field of fields) {
      if (remaining <= LAKE_ROW_BYTES - 200) break;
      delete kept[field.name];
      omitted.push(field.name);
      remaining -= field.bytes;
    }
    kept._omitted = { fields: omitted, bytes: size(payload) };
    const fitted: JsonObject = { ...row, payload: kept };
    if (size(fitted) <= LAKE_ROW_BYTES) {
      console.warn(JSON.stringify({ event: "lake_row_fitted", product: row.product_slug, entity: row.entity_key, bytes, omitted }));
      return fitted;
    }
  }
  console.error(JSON.stringify({ event: "lake_row_left_out", table, product: row.product_slug, revision: row.revision_id, bytes }));
  return undefined;
}

/** Reject a row the stream schema would refuse before it is accepted into the outbox. */
export function validateLakeRow(row: JsonObject, table: LakeTable): void {
  if (
    !isJsonString(row.batch_id) ||
    !isJsonString(row.feed_id) ||
    !isJsonString(row.acquisition_id) ||
    !isJsonString(row.revision_id) ||
    !isJsonString(row.product_slug) ||
    !isJsonObject(row.schema)
  ) {
    throw new NormalizedInputError("Lake rows require stable batch, revision, feed, product, and acquisition identities");
  }
  if (table === "records") {
    const invalid = [
      !isJsonString(row.entity_key) && "entity_key",
      !isJsonString(row.operation) && "operation",
      !isJsonNumber(row.product_version) && "product_version",
      !isTimestamp(row.observed_at) && "observed_at",
      !isTimestamp(row.ingested_at) && "ingested_at",
      !optionalTimestamp(row.event_time) && "event_time",
      !optionalTimestamp(row.valid_from) && "valid_from",
      !optionalTimestamp(row.valid_to) && "valid_to",
      !optionalTimestamp(row.source_published_at) && "source_published_at",
      !isJsonObject(row.payload) && "payload",
    ].filter((field): field is string => Boolean(field));
    if (invalid.length > 0) throw new NormalizedInputError(`Record history row has invalid fields: ${invalid.join(", ")}`);
    return;
  }
  if (
    !isJsonString(row.series_key) ||
    !isTimestamp(row.event_time) ||
    !isJsonNumber(row.value) ||
    !isJsonString(row.unit) ||
    !isJsonObject(row.dimensions) ||
    !isTimestamp(row.observed_at)
  ) {
    throw new NormalizedInputError("Series history row does not match the configured schema");
  }
}

function isTimestamp(value: JsonValue | undefined): boolean {
  return isJsonString(value) && !Number.isNaN(Date.parse(value));
}

function optionalTimestamp(value: JsonValue | undefined): boolean {
  return value === undefined || isTimestamp(value);
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
