import { GatekeeperError } from "./index";
import { parseJsonBytes, type JsonValue } from "./json";
import { readBoundedBytes } from "./stream";

/** `Retry-After` as whole seconds from now, in either its delay or its HTTP-date form. */
export function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get("retry-after")?.trim();
  if (!value) return undefined;
  if (/^\d+$/u.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) ? seconds : undefined;
  }
  const at = Date.parse(value);
  return Number.isNaN(at) ? undefined : Math.max(0, Math.ceil((at - Date.now()) / 1000));
}

/**
 * An upstream body read whole under a byte budget. A `content-length` past the
 * budget is refused before a byte is read; a body that grows past it while
 * streaming is cancelled. `what` names the resource in the error.
 */
export async function readBoundedResponse(response: Response, maximumBytes: number, what: string): Promise<Uint8Array> {
  const declared = response.headers.get("content-length");
  if (declared !== null && Number(declared) > maximumBytes) {
    await response.body?.cancel(`${what} declared more than ${maximumBytes} bytes`).catch(() => undefined);
    throw responseTooLarge(what, maximumBytes);
  }
  if (!response.body) throw invalidResponse(`${what} had no body`);
  try {
    return await readBoundedBytes(response.body, maximumBytes);
  } catch (error) {
    if (error instanceof GatekeeperError && error.code === "response-too-large") throw responseTooLarge(what, maximumBytes);
    throw error;
  }
}

/** The JSON an upstream body carries, read whole under a byte budget. */
export async function readBoundedJson(response: Response, maximumBytes: number, what: string): Promise<JsonValue> {
  const bytes = await readBoundedResponse(response, maximumBytes, what);
  try {
    return parseJsonBytes(bytes);
  } catch {
    throw invalidResponse(`${what} was not valid JSON`);
  }
}

function responseTooLarge(what: string, maximumBytes: number): GatekeeperError {
  return new GatekeeperError(`${what} exceeds ${maximumBytes} bytes`, "response-too-large");
}

/** A source answered, but not with what it promised: never worth a retry. */
export function invalidResponse(message: string): GatekeeperError {
  return new GatekeeperError(message, "invalid-response");
}

/** A strong entity tag naming exactly the bytes a source returned. */
export async function contentEtag(bytes: Uint8Array): Promise<string> {
  return `"sha256-${await sha256Hex(bytes)}"`;
}

/** SHA-256 of bytes or of UTF-8 text, as lowercase hexadecimal. */
export async function sha256Hex(value: Uint8Array | string): Promise<string> {
  const bytes = value instanceof Uint8Array ? value : new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** A 64-bit FNV-1a digest: for validators synthesized from metadata a source states, not from its bytes. */
export function hashString(value: string): string {
  let hash = 0xcbf29ce484222325n;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= BigInt(value.charCodeAt(index));
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }
  return hash.toString(16).padStart(16, "0");
}

/** Two entity tags naming the same representation; the weak marker never distinguishes one. */
export function equivalentEtags(left: string, right: string): boolean {
  const normalize = (value: string): string => value.replace(/^W\//u, "").trim();
  return normalize(left) === normalize(right);
}

/** The host allowlist an `ALLOWED_HOSTS` variable names, lower-cased. */
export function allowedHosts(value: string): ReadonlySet<string> {
  return new Set(
    value
      .split(",")
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host !== ""),
  );
}

/**
 * The single origin a one-source Gatekeeper may reach. The configured value
 * must be that origin's root and nothing else, so no path, query or credential
 * can ride along; the origin itself comes back for building URLs from.
 */
export function fixedOrigin(value: string, expected: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new GatekeeperError(`Source origin is invalid: ${value}`, "source-denied");
  }
  if (url.origin !== expected || url.href !== `${expected}/`) {
    throw new GatekeeperError(`Source origin is not allowed: ${value}`, "source-denied");
  }
  return url.origin;
}

/** A time a source stated, as ISO 8601 UTC; undefined when it stated none the clock can read. */
export function isoDate(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const milliseconds = Date.parse(value);
  return Number.isNaN(milliseconds) ? undefined : new Date(milliseconds).toISOString();
}
