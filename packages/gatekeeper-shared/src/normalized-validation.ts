import { parseJson, asNumber, asString, isJsonArray, isJsonBoolean, isJsonNumber, isJsonObject, isJsonString, type JsonObject, type JsonValue } from "./json";
import { NORMALIZED_PROTOCOL, type CollectionRequest, type CollectionResult, type HistoryCursor, type ResolvedFeed, type SourceCheckpoint } from "./index";

const NORMALIZED_ERROR_PREFIX = "Normalized contract rejected: [open-data/normalized-input] ";

/** Canonical JSON framing makes wrapped/prefixed/suffixed RPC error text unambiguous. */
export class NormalizedInputError extends Error {
  constructor(message: string) {
    super(`${NORMALIZED_ERROR_PREFIX}${JSON.stringify(message)}`);
    this.name = "NormalizedInputError";
  }
}

export function isPermanentCollectionError(error: Error): boolean {
  if (error instanceof NormalizedInputError) return true;
  if (!error.message.startsWith(NORMALIZED_ERROR_PREFIX)) return false;
  try {
    const detail = parseJson(error.message.slice(NORMALIZED_ERROR_PREFIX.length));
    return isJsonString(detail) && error.message === new NormalizedInputError(detail).message;
  } catch { return false; }
}

export function isProductSlug(value: JsonValue | undefined): value is string {
  return isJsonString(value) && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 200;
}

function isTimestamp(value: JsonValue | undefined): value is string {
  if (!isJsonString(value) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  const canonical = new Date(time).toISOString();
  // Full milliseconds, the form nearly every frame carries, already are canonical; only shorter fractions need padding.
  if (value.length === 24) return canonical === value;
  return canonical === value.replace(/(?:\.(\d{1,3}))?Z$/, (_, fraction: string | undefined) => `.${(fraction ?? "").padEnd(3, "0")}Z`);
}

function optionalTime(value: JsonValue | undefined): boolean { return value === undefined || isTimestamp(value); }
function text(value: JsonValue | undefined, max = 4096): value is string { return isJsonString(value) && value.trim().length > 0 && value.length <= max; }
function optionalText(value: JsonValue | undefined): boolean { return value === undefined || text(value); }
function count(value: JsonValue | undefined): boolean { const n = asNumber(value); return n !== undefined && Number.isSafeInteger(n) && n >= 0; }
function bounded(value: JsonValue, bytes: number): boolean { return new TextEncoder().encode(JSON.stringify(value)).byteLength <= bytes; }
function onlyKeys(value: JsonObject, keys: string[]): boolean { return Object.keys(value).every((key) => keys.includes(key)); }
function timeRange(from: JsonValue | undefined, to: JsonValue | undefined): boolean { return optionalTime(from) && optionalTime(to) && (from === undefined || to === undefined || Date.parse(String(from)) <= Date.parse(String(to))); }

function isHistoryCursor(value: JsonValue | undefined): value is JsonObject & HistoryCursor {
  return isJsonObject(value) && onlyKeys(value, ["before", "offset", "token"]) && isTimestamp(value.before)
    && (value.offset === undefined || count(value.offset)) && (value.token === undefined || text(value.token, 2048)) && bounded(value, 4096);
}

const FAILURE_CODES = ["invalid-config", "source-denied", "upstream-error", "invalid-response", "response-too-large", "deadline-exceeded", "history-unsupported", "protocol-mismatch"] as const;

/** Narrow a Gatekeeper's resolved feed descriptor before the kernel persists or executes it. */
export function assertResolvedFeed(value: ResolvedFeed): void {
  let parsed: JsonValue;
  try { parsed = parseJson(JSON.stringify(value)); }
  catch { throw new NormalizedInputError("Gatekeeper returned an invalid resolved feed"); }
  if (!isJsonObject(parsed) || !onlyKeys(parsed, ["config", "configHash", "resourceKey", "kind", "semantics", "history"])
    || !isJsonObject(parsed.config) || !Object.values(parsed.config).every(isJsonString)
    || !isJsonString(parsed.configHash) || !/^[0-9a-f]{64}$/.test(parsed.configHash)
    || !text(parsed.resourceKey, 1024) || !text(parsed.kind, 256) || !isJsonObject(parsed.semantics)) throw new NormalizedInputError("Gatekeeper returned an invalid resolved feed");
  const semantics = parsed.semantics;
  if (!onlyKeys(semantics, ["domainSubject", "defaultProductRole"])
    || !["coverage", "document", "event", "feature", "media", "observation", "reference"].includes(asString(semantics.domainSubject) ?? "")
    || !["current-state", "event-log", "reference", "summary", "time-series"].includes(asString(semantics.defaultProductRole) ?? "")) {
    throw new NormalizedInputError("Gatekeeper returned invalid feed semantics");
  }
  if (parsed.history !== undefined) {
    if (!isJsonObject(parsed.history) || !onlyKeys(parsed.history, ["earliest"])
      || (parsed.history.earliest !== undefined && !isTimestamp(parsed.history.earliest))) throw new NormalizedInputError("Gatekeeper returned an invalid history capability");
  }
}

function validCheckpoint(value: SourceCheckpoint | undefined): boolean {
  if (value === undefined) return false;
  try { return isSourceCheckpoint(parseJson(JSON.stringify(value))); }
  catch { return false; }
}

export function assertSourceCheckpoint(value: SourceCheckpoint): void {
  if (!validCheckpoint(value)) throw new NormalizedInputError("Source checkpoint exceeds its bounded contract");
}

/** Validate the non-stream RPC envelope before the kernel acts on an untrusted Gatekeeper result. */
export function assertCollectionResult(result: CollectionResult, mode: CollectionRequest["mode"]): void {
  const exact = (keys: string[]) => Object.keys(result).every((key) => keys.includes(key));
  switch (result.kind) {
    case "batch":
      if (!exact(["kind", "stream"]) || !(result.stream instanceof ReadableStream)) throw new NormalizedInputError("Gatekeeper returned an invalid batch result");
      return;
    case "unchanged":
      if (mode.kind !== "live" || !exact(["kind", "checkpoint"]) || !validCheckpoint(result.checkpoint)) throw new NormalizedInputError("Gatekeeper returned an invalid unchanged result");
      return;
    case "exhausted":
      if (mode.kind !== "history" || !exact(["kind"])) throw new NormalizedInputError("Gatekeeper returned an invalid exhausted result");
      return;
    case "failure":
      if (!exact(["kind", "code", "retryable", "retryAfterSeconds"]) || !FAILURE_CODES.includes(result.code) || !isJsonBoolean(result.retryable)
        || (result.retryAfterSeconds !== undefined && (!Number.isSafeInteger(result.retryAfterSeconds) || result.retryAfterSeconds < 0))) throw new NormalizedInputError("Gatekeeper returned an invalid failure result");
      return;
  }
}

export function historyCursorKey(cursor: HistoryCursor): string {
  return JSON.stringify([new Date(cursor.before).toISOString(), cursor.offset ?? null, cursor.token ?? null]);
}

/** Opaque tokens have no kernel-defined order, but their explicit time bounds must not move forwards. */
export function assertHistoryProgress(current: HistoryCursor, next: HistoryCursor | undefined, exhausted: boolean, visited: string[] = []): void {
  if ((next !== undefined) === exhausted) throw new NormalizedInputError("History requires explicit continuation or exhaustion, not both");
  if (!next) return;
  if (!isHistoryCursor({ ...next })) throw new NormalizedInputError("Invalid history continuation");
  const key = historyCursorKey(next);
  if (key === historyCursorKey(current) || visited.includes(key)) throw new NormalizedInputError("History cursor repeated or cycled");
  const previousTime = Date.parse(current.before);
  const nextTime = Date.parse(next.before);
  if (nextTime > previousTime) throw new NormalizedInputError("History cursor time bound moved forwards");
  if (next.token !== undefined) return;
  if (nextTime === previousTime && (next.offset === undefined || next.offset <= (current.offset ?? 0))) {
    throw new NormalizedInputError("History cursor did not progress backwards or advance its offset");
  }
}

function schema(value: JsonValue | undefined): boolean {
  if (!isJsonObject(value) || !isJsonArray(value.fields) || value.fields.length > 1024) return false;
  const ids = new Set<string>();
  return value.fields.every((field) => {
    if (!isJsonObject(field) || !onlyKeys(field, ["id", "name", "type", "nullable", "unit", "display"]) || !text(field.id) || ids.has(field.id) || !text(field.name) || !isJsonBoolean(field.nullable)
      || !["boolean", "category", "color", "date", "datetime", "geometry", "identifier", "json", "latitude", "longitude", "number", "string", "url"].includes(asString(field.type) ?? "")
      || !optionalText(field.unit)) return false;
    ids.add(field.id);
    if (field.display === undefined) return true;
    if (!isJsonObject(field.display) || !onlyKeys(field.display, ["label", "badge"]) || !optionalText(field.display.label)) return false;
    const badge = field.display.badge;
    return badge === undefined || (isJsonObject(badge) && onlyKeys(badge, ["colorField", "textColorField"]) && text(badge.colorField) && optionalText(badge.textColorField));
  });
}
function product(value: JsonValue): boolean {
  return isJsonObject(value)
    && onlyKeys(value, ["productKey", "suggestedSlug", "title", "description", "role", "schema", "kind", "updateMode", "completeness", "watermark"])
    && text(value.productKey, 256) && isProductSlug(value.suggestedSlug) && text(value.title) && isJsonString(value.description)
    && ["current-state", "event-log", "reference", "summary", "time-series"].includes(asString(value.role) ?? "")
    && schema(value.schema) && ["record", "series"].includes(asString(value.kind) ?? "")
    && (value.kind !== "series" || value.role === "time-series")
    && ["authoritative-snapshot", "partial-snapshot", "delta", "source-window"].includes(asString(value.updateMode) ?? "")
    && (value.kind !== "series" || value.updateMode !== "partial-snapshot")
    && ["complete", "partial", "unknown"].includes(asString(value.completeness) ?? "") && optionalTime(value.watermark);
}
function isSourceCheckpoint(value: JsonValue | undefined): boolean {
  if (!isJsonObject(value) || !onlyKeys(value, ["version", "resourceKey", "configHash", "feedEpoch", "normalizer", "state"]) || value.version !== 2 || !text(value.resourceKey, 1024) || !text(value.configHash, 256) || !text(value.feedEpoch, 256)
    || !isJsonObject(value.normalizer) || !onlyKeys(value.normalizer, ["id", "version"]) || !text(value.normalizer.id, 256) || !text(value.normalizer.version, 256)
    || !isJsonObject(value.state) || !bounded(value.state, 16_384)) return false;
  return boundedState(value.state);
}
function finalization(value: JsonValue): boolean {
  return isJsonObject(value) && onlyKeys(value, ["productKey", "schema", "watermark", "completeness"]) && text(value.productKey, 256)
    && (value.schema === undefined || schema(value.schema)) && optionalTime(value.watermark)
    && (value.completeness === undefined || ["complete", "partial", "unknown"].includes(asString(value.completeness) ?? ""));
}
function record(value: JsonValue | undefined): boolean {
  return isJsonObject(value) && onlyKeys(value, ["entityKey", "operation", "payload", "eventTime", "validFrom", "validTo", "sourcePublishedAt", "sourceSequence"])
    && text(value.entityKey) && isJsonObject(value.payload)
    && (value.operation === undefined || ["correct", "create", "delete", "retract", "upsert"].includes(asString(value.operation) ?? ""))
    && optionalTime(value.eventTime) && timeRange(value.validFrom, value.validTo) && optionalTime(value.sourcePublishedAt) && optionalText(value.sourceSequence);
}
function point(value: JsonValue | undefined): boolean {
  return isJsonObject(value) && onlyKeys(value, ["seriesKey", "eventTime", "value", "unit", "dimensions"]) && text(value.seriesKey) && isTimestamp(value.eventTime) && asNumber(value.value) !== undefined
    && isJsonString(value.unit) && isJsonObject(value.dimensions) && Object.values(value.dimensions).every(isJsonString);
}

function boundedState(value: JsonValue, depth = 0): boolean {
  if (depth > 32) return false;
  if (isJsonString(value)) return value.length <= 4096;
  if (isJsonArray(value)) return value.length <= 1024 && value.every((item) => boundedState(item, depth + 1));
  if (isJsonObject(value)) return Object.keys(value).length <= 256 && Object.entries(value).every(([key, item]) => key.length <= 256 && boundedState(item, depth + 1));
  return !isJsonNumber(value) || Number.isFinite(value);
}

/**
 * Per-row checks are deliberately cheap: shape, identity, timestamps and finite
 * point values. Payload values are opaque JSON; a non-finite number cannot
 * survive JSON serialization anyway.
 */
export function isNormalizedFrame(value: JsonObject): boolean {
  if (value.type === "record") return onlyKeys(value, ["type", "productKey", "value"]) && text(value.productKey, 256) && record(value.value);
  if (value.type === "point") return onlyKeys(value, ["type", "productKey", "value"]) && text(value.productKey, 256) && point(value.value) && Number.isFinite(asNumber(asObjectValue(value.value)));
  if (value.type === "header") {
    const normalizer = isJsonObject(value.normalizer) ? value.normalizer : undefined;
    const provenance = isJsonObject(value.provenance) ? value.provenance : undefined;
    return onlyKeys(value, ["type", "protocol", "collectionId", "normalizer", "products", "provenance", "completeness", "checkpoint"])
      && value.protocol === NORMALIZED_PROTOCOL && text(value.collectionId, 200)
      && isJsonObject(normalizer) && onlyKeys(normalizer, ["id", "version"]) && text(normalizer.id, 256) && text(normalizer.version, 256)
      && isJsonArray(value.products) && value.products.every(product)
      && isJsonObject(provenance) && onlyKeys(provenance, ["sourceUrl", "sourcePublishedAt"]) && text(provenance.sourceUrl) && optionalTime(provenance.sourcePublishedAt)
      && ["complete", "partial", "unknown"].includes(asString(value.completeness) ?? "")
      && isSourceCheckpoint(value.checkpoint);
  }
  if (value.type !== "complete") return false;
  const counts = isJsonObject(value.counts) ? value.counts : undefined;
  const quality = isJsonObject(value.quality) ? value.quality : undefined;
  return onlyKeys(value, ["type", "counts", "quality", "products", "nextCursor", "exhausted"])
    && isJsonObject(counts) && onlyKeys(counts, ["records", "points"])
    && isJsonObject(quality) && onlyKeys(quality, ["acceptedRecords", "rejectedRecords"])
    && count(counts.records) && count(counts.points) && count(quality.acceptedRecords) && count(quality.rejectedRecords)
    && (value.products === undefined || (isJsonArray(value.products) && value.products.length <= 256 && value.products.every(finalization)))
    && (value.nextCursor === undefined || isHistoryCursor(value.nextCursor)) && (value.exhausted === undefined || isJsonBoolean(value.exhausted))
    && !(value.nextCursor !== undefined && value.exhausted === true);
}

function asObjectValue(value: JsonValue | undefined): JsonValue | undefined {
  return isJsonObject(value) ? value.value : undefined;
}
