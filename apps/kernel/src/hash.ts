import { isJsonArray, isJsonObject, type JsonValue } from "@open-data-pt/contract";

/**
 * Fast non-cryptographic hashing for change detection and stable identities.
 * Integer math only (Math.imul): the former BigInt FNV cost one BigInt
 * operation per character, which dominated CPU on large batches.
 */
export function hash53(text: string, seed = 0): number {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    h1 = Math.imul(h1 ^ code, 2654435761);
    h2 = Math.imul(h2 ^ code, 1597334677);
  }
  return finish53(h1, h2);
}

function finish53(h1: number, h2: number): number {
  const mixed1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  const mixed2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(mixed1 ^ (mixed1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & mixed2) + (mixed1 >>> 0);
}

const SECOND_SEED = 0x9e3779b9;

/**
 * 106-bit hex digest from two independently seeded 53-bit hashes: the value
 * of `hash53(text, 0)` and `hash53(text, SECOND_SEED)`, computed in one pass
 * over the text. Every stored row hash is this value, so it must never change.
 */
export function digest(text: string): string {
  let a1 = 0xdeadbeef ^ 0;
  let a2 = 0x41c6ce57 ^ 0;
  let b1 = 0xdeadbeef ^ SECOND_SEED;
  let b2 = 0x41c6ce57 ^ SECOND_SEED;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    a1 = Math.imul(a1 ^ code, 2654435761);
    a2 = Math.imul(a2 ^ code, 1597334677);
    b1 = Math.imul(b1 ^ code, 2654435761);
    b2 = Math.imul(b2 ^ code, 1597334677);
  }
  return finish53(a1, a2).toString(16).padStart(14, "0") + finish53(b1, b2).toString(16).padStart(14, "0");
}

/** 32-bit FNV-1a over UTF-16 code units; used where only a bucket is needed. */
export function hash32(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** JSON with object keys sorted, so input member order never looks like a change. */
export function stableStringify(value: JsonValue | undefined): string {
  if (value === undefined) return "null";
  if (isJsonArray(value)) {
    let out = "[";
    for (let index = 0; index < value.length; index += 1) {
      if (index > 0) out += ",";
      out += stableStringify(value[index]);
    }
    return `${out}]`;
  }
  if (isJsonObject(value)) {
    const keys = Object.keys(value).sort();
    let out = "{";
    let first = true;
    for (const key of keys) {
      const child = value[key];
      if (child === undefined) continue;
      if (!first) out += ",";
      first = false;
      out += `${JSON.stringify(key)}:${stableStringify(child)}`;
    }
    return `${out}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(content: string | Uint8Array): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", content instanceof Uint8Array ? content : new TextEncoder().encode(content));
  let out = "";
  for (const byte of new Uint8Array(bytes)) out += byte.toString(16).padStart(2, "0");
  return out;
}
