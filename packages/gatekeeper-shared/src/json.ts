/**
 * The value domain every source payload lands in once its bytes are decoded.
 * A Gatekeeper reads a `JsonValue` at its I/O boundary and narrows it into its
 * own record types; nothing further down the platform should still be holding
 * one, apart from the payloads a product carries verbatim.
 */
export type JsonValue = string | number | boolean | null | JsonArray | JsonObject;

/** A decoded JSON array. */
interface JsonArray extends Array<JsonValue> {}

/** A decoded JSON object: string keys, JSON values. */
export interface JsonObject {
  [key: string]: JsonValue;
}

/*
 * The predicates below are the only place in the platform that inspects a
 * runtime tag. Every other module narrows a JsonValue by calling one of them,
 * so the question "what did the source actually send?" is asked once, here.
 */

export function isJsonObject(value: JsonValue | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isJsonArray(value: JsonValue | undefined): value is JsonValue[] {
  return Array.isArray(value);
}

export function isJsonString(value: JsonValue | undefined): value is string {
  return typeof value === "string";
}

export function isJsonNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number";
}

export function isJsonBoolean(value: JsonValue | undefined): value is boolean {
  return typeof value === "boolean";
}

/* ---------- Decoders: a JsonValue in, a domain value or `undefined` out ---------- */

/** The string a source sent, or `undefined` when it sent anything else. */
export function asString(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) ? value : undefined;
}

/** A string with content: blank and whitespace-only readings are absences. */
export function asNonEmptyString(value: JsonValue | undefined): string | undefined {
  return isJsonString(value) && value.trim() !== "" ? value : undefined;
}

/** A finite number; NaN and the infinities are unusable readings. */
export function asNumber(value: JsonValue | undefined): number | undefined {
  return isJsonNumber(value) && Number.isFinite(value) ? value : undefined;
}

export function asBoolean(value: JsonValue | undefined): boolean | undefined {
  return isJsonBoolean(value) ? value : undefined;
}

export function asObject(value: JsonValue | undefined): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

export function asArray(value: JsonValue | undefined): JsonValue[] | undefined {
  return isJsonArray(value) ? value : undefined;
}

/** Every element the source listed, or an empty list when it listed nothing. */
export function asArrayOrEmpty(value: JsonValue | undefined): JsonValue[] {
  return isJsonArray(value) ? value : [];
}

/**
 * A number the source may have written as a numeric string, which is how most
 * CSV-backed and form-encoded sources publish measurements.
 */
export function asNumberLike(value: JsonValue | undefined): number | undefined {
  if (isJsonNumber(value)) return Number.isFinite(value) ? value : undefined;
  const text = asNonEmptyString(value);
  if (text === undefined) return undefined;
  const parsed = Number(text.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Every element read as a string, or `undefined` when any element was not one. */
export function asStringList(value: JsonValue | undefined): string[] | undefined {
  const entries = asArray(value);
  if (entries === undefined) return undefined;
  const strings = entries.filter(isJsonString);
  return strings.length === entries.length ? strings : undefined;
}

/** Every element read as a number, or `undefined` when any element was not one. */
export function asNumberList(value: JsonValue | undefined): number[] | undefined {
  const entries = asArray(value);
  if (entries === undefined) return undefined;
  const numbers = entries.filter(isJsonNumber);
  return numbers.length === entries.length ? numbers : undefined;
}

/**
 * A record as the JSON object it serializes to, with its absent fields left
 * out. Optional properties are absences, and JSON has no way to spell one.
 */
export function toJsonObject<T extends object>(record: T): JsonObject {
  const json: JsonObject = {};
  for (const [field, value] of Object.entries(record)) {
    if (value !== undefined) json[field] = value;
  }
  return json;
}

/* ---------- The boundary itself ---------- */

/** Decode JSON text into the JSON value domain, or throw the parser's own error. */
export function parseJson(text: string): JsonValue {
  // SAFETY: JSON.parse only ever yields the JSON value domain — objects, arrays,
  // strings, numbers, booleans and null — which is exactly what JsonValue names.
  // The compiler cannot see that because the standard library types it as `any`.
  return JSON.parse(text) as JsonValue;
}

/** Decode UTF-8 JSON bytes as they arrive from a source or from R2. */
export function parseJsonBytes(bytes: Uint8Array): JsonValue {
  return parseJson(new TextDecoder().decode(bytes));
}
