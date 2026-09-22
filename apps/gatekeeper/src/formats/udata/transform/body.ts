import { isJsonString, parseJson } from "../../../index";

/** The first bytes of a body, and the whole body again with those bytes still at its front. */
export interface PeekedBody {
  prefix: Uint8Array;
  /** The prefix is the entire body. */
  complete: boolean;
  body: ReadableStream<Uint8Array>;
}

/**
 * Read at least `bytes` from the front of a body (or all of it, when shorter)
 * so a translator can decide encoding and layout before it streams the rest.
 */
export async function peekBody(body: ReadableStream<Uint8Array>, bytes: number): Promise<PeekedBody> {
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  let complete = false;
  while (size < bytes) {
    const part = await reader.read();
    if (part.done) {
      complete = true;
      break;
    }
    chunks.push(part.value);
    size += part.value.byteLength;
  }
  const prefix = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    prefix.set(chunk, offset);
    offset += chunk.byteLength;
  }
  let replayed = false;
  const replay = new ReadableStream<Uint8Array>({
    async pull(controller) {
      if (!replayed) {
        replayed = true;
        if (prefix.byteLength > 0) {
          controller.enqueue(prefix);
          return;
        }
      }
      if (complete) {
        controller.close();
        return;
      }
      const part = await reader.read();
      if (part.done) controller.close();
      else controller.enqueue(part.value);
    },
    cancel(reason) {
      return reader.cancel(reason);
    },
  });
  return { prefix, complete, body: replay };
}

/** Strict UTF-8 over the prefix; a character cut at its end only counts against a complete body. */
export function isUtf8(prefix: Uint8Array, complete: boolean): boolean {
  try {
    new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(prefix, { stream: !complete });
    return true;
  } catch {
    return false;
  }
}

/** Prefix text for sniffing only: UTF-8, or one character per byte. */
export function sniffText(prefix: Uint8Array, utf8: boolean): string {
  if (utf8) return new TextDecoder().decode(prefix);
  let text = "";
  for (let offset = 0; offset < prefix.byteLength; offset += 8192) {
    text += String.fromCharCode(...prefix.subarray(offset, offset + 8192));
  }
  return text;
}

/** What a bounded prefix of a JSON document says about where its rows are. */
export interface JsonSniff {
  root: "array" | "object" | "other";
  /** Top-level members whose value is an array, in document order, as far as the prefix reaches. */
  arrays: string[];
  /** The top-level `type` member, when it is a string read within the prefix. */
  type?: string;
}

/** Walk the top level of a JSON prefix: which members hold arrays, and what `type` says. */
export function sniffJson(text: string): JsonSniff {
  let index = 0;
  while (index < text.length && /[\s\uFEFF]/.test(text[index]!)) index += 1;
  const first = text[index];
  if (first === "[") return { root: "array", arrays: [] };
  if (first !== "{") return { root: "other", arrays: [] };
  const sniff: JsonSniff = { root: "object", arrays: [] };
  let depth = 0;
  let state: "key" | "colon" | "value" | "next" = "key";
  let key: string | undefined;
  for (index += 1; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      const end = stringEnd(text, index);
      if (end < 0) break;
      if (depth === 0 && state === "key") {
        key = stringLiteral(text.slice(index, end + 1));
        state = "colon";
      } else if (depth === 0 && state === "value") {
        const value = stringLiteral(text.slice(index, end + 1));
        if (key === "type" && value !== undefined) sniff.type = value;
        state = "next";
      }
      index = end;
      continue;
    }
    if (depth > 0) {
      if (character === "{" || character === "[") depth += 1;
      else if (character === "}" || character === "]") {
        depth -= 1;
        if (depth === 0) state = "next";
      }
      continue;
    }
    if (character === ":" && state === "colon") state = "value";
    else if (character === "," && state === "next") {
      state = "key";
      key = undefined;
    } else if (character === "}") break;
    else if (state === "value" && !/\s/.test(character)) {
      if (character === "[" || character === "{") {
        if (character === "[" && key !== undefined) sniff.arrays.push(key);
        depth = 1;
      } else {
        state = "next";
      }
    }
  }
  return sniff;
}

function stringEnd(text: string, start: number): number {
  for (let index = start + 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === "\\") index += 1;
    else if (character === '"') return index;
  }
  return -1;
}

function stringLiteral(literal: string): string | undefined {
  try {
    const value = parseJson(literal);
    return isJsonString(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
