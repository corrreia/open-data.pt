import { GatekeeperError } from "./index";
import { isJsonObject, isJsonString, parseJson } from "./json";

import type { JsonObject, JsonValue } from "./json";

/** Bounds for one streamed JSON document. */
export interface JsonArrayStreamOptions {
  /** Largest serialized element accepted, in bytes. Default 1 MiB. */
  maxElementBytes?: number;
  /** Largest total of everything outside the streamed array, in bytes. Default 256 KiB. */
  maxEnvelopeBytes?: number;
}

/** The elements of one array inside a streamed JSON document, plus the document around it. */
export interface JsonArrayStream {
  /** Each element of the array at the requested path, parsed, in document order. */
  elements: AsyncIterable<JsonValue>;
  /**
   * Every member outside the streamed array (for example `total_count`), with
   * the array itself replaced by an empty array. Complete only after
   * `elements` has been fully consumed.
   */
  envelope(): JsonObject;
}

const DEFAULT_ELEMENT_BYTES = 1024 * 1024;
const DEFAULT_ENVELOPE_BYTES = 256 * 1024;

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const COMMA = 0x2c;
const OPEN_BRACE = 0x7b;
const CLOSE_BRACE = 0x7d;
const OPEN_BRACKET = 0x5b;
const CLOSE_BRACKET = 0x5d;
const NEWLINE = 0x0a;
const UTF8_BOM = [0xef, 0xbb, 0xbf] as const;

const decoder = new TextDecoder();

/**
 * Stream the elements of the JSON array found at `path` in a document such as
 * `{"features": [...]}` (`path = ["features"]`) or a top-level array
 * (`path = []`), holding at most one element in memory at a time.
 *
 * Several paths may be given, as `[["features"], ["data", "features"]]`, for a
 * format one service publishes plainly and another wraps in an envelope: the
 * first of them the document turns out to hold is the array that is streamed.
 * They must not be prefixes of one another, so that at most one can match.
 */
export function streamJsonArray(body: ReadableStream<Uint8Array>, path: JsonArrayPath, options?: JsonArrayStreamOptions): JsonArrayStream {
  const scanner = new ArrayScanner(candidatePaths(path), options?.maxElementBytes ?? DEFAULT_ELEMENT_BYTES, options?.maxEnvelopeBytes ?? DEFAULT_ENVELOPE_BYTES);
  return { elements: scanElements(body, scanner), envelope: () => scanner.envelope() };
}

/** Where the array sits: one path of object keys, or several to choose between. */
export type JsonArrayPath = readonly string[] | readonly (readonly string[])[];

/**
 * The two arms of `JsonArrayPath` are told apart by what the array holds: every
 * member an array means it is a list of paths, and a member that is not means
 * it is one path of keys. An empty array is one empty path, which is how a
 * top-level array is asked for.
 */
function isPathList(path: JsonArrayPath): path is ReadonlyArray<readonly string[]> {
  return path.length > 0 && path.every((member) => Array.isArray(member));
}

function candidatePaths(path: JsonArrayPath): ReadonlyArray<readonly string[]> {
  const candidates = isPathList(path) ? path : [path];
  for (const one of candidates) {
    for (const other of candidates) {
      if (one === other) continue;
      if (one.length <= other.length && one.every((key, index) => key === other[index])) {
        throw new Error("Streamed array paths must not be prefixes of one another");
      }
    }
  }
  return candidates;
}

/** Parse newline-delimited JSON one line at a time. */
export function streamNdjson(body: ReadableStream<Uint8Array>, options?: JsonArrayStreamOptions): AsyncIterable<JsonValue> {
  return ndjsonValues(body, options?.maxElementBytes ?? DEFAULT_ELEMENT_BYTES);
}

async function* scanElements(body: ReadableStream<Uint8Array>, scanner: ArrayScanner): AsyncGenerator<JsonValue> {
  const reader = body.getReader();
  let finished = false;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      yield* scanner.scan(part.value);
    }
    finished = true;
    scanner.finish();
  } finally {
    if (!finished) await reader.cancel("JSON stream closed early").catch(() => undefined);
    reader.releaseLock();
  }
}

async function* ndjsonValues(body: ReadableStream<Uint8Array>, maximumBytes: number): AsyncGenerator<JsonValue> {
  const line = new BoundedBytes(maximumBytes, () => tooLarge(`NDJSON line exceeds ${maximumBytes} bytes`));
  const reader = body.getReader();
  let finished = false;
  let lineNumber = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = part.value;
      let start = 0;
      for (let end = chunk.indexOf(NEWLINE); end >= 0; end = chunk.indexOf(NEWLINE, start)) {
        line.append(chunk, start, end);
        start = end + 1;
        lineNumber += 1;
        const value = ndjsonLine(line, lineNumber);
        if (value !== undefined) yield value;
      }
      line.append(chunk, start, chunk.byteLength);
    }
    finished = true;
    const value = ndjsonLine(line, lineNumber + 1);
    if (value !== undefined) yield value;
  } finally {
    if (!finished) await reader.cancel("NDJSON stream closed early").catch(() => undefined);
    reader.releaseLock();
  }
}

function ndjsonLine(line: BoundedBytes, lineNumber: number): JsonValue | undefined {
  // `trim` also drops the carriage return of CRLF lines and a leading BOM.
  const text = line.text().trim();
  line.reset();
  if (text === "") return undefined;
  try {
    return parseJson(text);
  } catch {
    throw malformed(`NDJSON line ${lineNumber} is not valid JSON`);
  }
}

/** A growable byte buffer that refuses to grow past its limit. */
class BoundedBytes {
  private bytes = new Uint8Array(256);
  private length = 0;

  private readonly limit: number;
  private readonly overflow: () => GatekeeperError;

  constructor(limit: number, overflow: () => GatekeeperError) {
    this.limit = limit;
    this.overflow = overflow;
  }

  get size(): number {
    return this.length;
  }

  append(chunk: Uint8Array, start: number, end: number): void {
    const size = end - start;
    if (size <= 0) return;
    if (this.length + size > this.limit) throw this.overflow();
    if (this.length + size > this.bytes.byteLength) {
      const grown = new Uint8Array(Math.min(this.limit, Math.max(this.bytes.byteLength * 2, this.length + size)));
      grown.set(this.bytes.subarray(0, this.length));
      this.bytes = grown;
    }
    this.bytes.set(chunk.subarray(start, end), this.length);
    this.length += size;
  }

  text(): string {
    return decoder.decode(this.bytes.subarray(0, this.length));
  }

  /** Forget the content; a buffer grown for one large element does not stay large. */
  reset(): void {
    this.length = 0;
    if (this.bytes.byteLength > 64 * 1024) this.bytes = new Uint8Array(256);
  }
}

/** One open container outside the streamed array. */
interface Frame {
  object: boolean;
  /** The member name the object is currently reading the value of. */
  key: string | undefined;
  /** An object between `{`/`,` and the next member name. */
  expectsKey: boolean;
}

/**
 * A byte-level scanner: it tracks strings, escapes and nesting, finds element
 * boundaries inside the target array, and hands each element's bytes to
 * `JSON.parse` whole. Bytes outside the array are kept as the envelope. Chunk
 * boundaries may fall anywhere, including inside a multi-byte character or an
 * escape, because bytes are only decoded once an element or key is complete.
 */
class ArrayScanner {
  private readonly frames: Frame[] = [];
  private phase: "before" | "inside" | "after" = "before";
  private inString = false;
  private escaped = false;
  /** Containers open inside the current element. */
  private innerDepth = 0;
  private elementOpen = false;
  /** A comma was read: another element must follow before the array closes. */
  private expectElement = false;
  private capturingKey = false;
  private bomMatched = 0;
  private done = false;
  private parsedEnvelope: JsonObject | undefined;
  private readonly key: BoundedBytes;
  private readonly element: BoundedBytes;
  private readonly outside: BoundedBytes;

  private readonly paths: ReadonlyArray<readonly string[]>;
  private readonly deepest: number;

  constructor(paths: ReadonlyArray<readonly string[]>, maxElementBytes: number, maxEnvelopeBytes: number) {
    this.paths = paths;
    this.deepest = Math.max(...paths.map((path) => path.length));
    const envelopeTooLarge = () => tooLarge(`JSON envelope exceeds ${maxEnvelopeBytes} bytes`);
    this.key = new BoundedBytes(maxEnvelopeBytes, envelopeTooLarge);
    this.outside = new BoundedBytes(maxEnvelopeBytes, envelopeTooLarge);
    this.element = new BoundedBytes(maxElementBytes, () => tooLarge(`JSON array element exceeds ${maxElementBytes} bytes`));
  }

  *scan(chunk: Uint8Array): Generator<JsonValue> {
    let index = 0;
    while (this.bomMatched >= 0 && this.bomMatched < UTF8_BOM.length && index < chunk.byteLength) {
      if (chunk[index] !== UTF8_BOM[this.bomMatched]) break;
      this.bomMatched += 1;
      index += 1;
    }
    if (index < chunk.byteLength) this.bomMatched = -1;
    let outsideStart = this.phase === "inside" ? -1 : index;
    let elementStart = this.elementOpen ? 0 : -1;
    let keyStart = this.capturingKey ? 0 : -1;

    for (; index < chunk.byteLength; index += 1) {
      const byte = chunk[index]!;
      if (this.inString) {
        if (this.escaped) this.escaped = false;
        else if (byte === BACKSLASH) this.escaped = true;
        else if (byte === QUOTE) {
          this.inString = false;
          if (keyStart >= 0) {
            this.key.append(chunk, keyStart, index + 1);
            keyStart = -1;
            this.finishKey();
          }
        }
        continue;
      }

      if (this.phase === "inside") {
        if (this.innerDepth > 0) {
          if (byte === QUOTE) this.inString = true;
          else if (byte === OPEN_BRACE || byte === OPEN_BRACKET) this.innerDepth += 1;
          else if (byte === CLOSE_BRACE || byte === CLOSE_BRACKET) this.innerDepth -= 1;
          continue;
        }
        if (byte === COMMA || byte === CLOSE_BRACKET) {
          if (this.elementOpen) {
            this.element.append(chunk, elementStart, index);
            elementStart = -1;
            yield this.finishElement();
          } else if (byte === COMMA || this.expectElement) {
            throw malformed("JSON array has an empty element");
          }
          if (byte === COMMA) {
            this.expectElement = true;
            continue;
          }
          this.phase = "after";
          outsideStart = index;
          continue;
        }
        if (!this.elementOpen) {
          if (isWhitespace(byte)) continue;
          this.elementOpen = true;
          this.expectElement = false;
          elementStart = index;
        }
        if (byte === QUOTE) this.inString = true;
        else if (byte === OPEN_BRACE || byte === OPEN_BRACKET) this.innerDepth += 1;
        else if (byte === CLOSE_BRACE) throw malformed("JSON array element closes a container it never opened");
        continue;
      }

      const frame = this.frames.at(-1);
      switch (byte) {
        case QUOTE:
          this.inString = true;
          if (this.phase === "before" && frame?.object && frame.expectsKey && this.frames.length <= this.deepest) {
            this.key.reset();
            this.capturingKey = true;
            keyStart = index;
          }
          break;
        case OPEN_BRACKET:
          if (this.phase === "before" && this.atTarget()) {
            this.outside.append(chunk, outsideStart, index + 1);
            outsideStart = -1;
            this.phase = "inside";
            break;
          }
          this.frames.push({ object: false, key: undefined, expectsKey: false });
          break;
        case OPEN_BRACE:
          this.frames.push({ object: true, key: undefined, expectsKey: true });
          break;
        case CLOSE_BRACE:
        case CLOSE_BRACKET:
          if (this.frames.pop() === undefined) throw malformed("JSON document closes a container it never opened");
          break;
        case COMMA:
          if (frame?.object) frame.expectsKey = true;
          break;
        default:
          break;
      }
    }

    if (outsideStart >= 0) this.outside.append(chunk, outsideStart, chunk.byteLength);
    if (elementStart >= 0) this.element.append(chunk, elementStart, chunk.byteLength);
    if (keyStart >= 0) this.key.append(chunk, keyStart, chunk.byteLength);
  }

  /** The document ended: it must be whole, and its envelope must parse. */
  finish(): void {
    if (this.inString || this.phase === "inside" || this.frames.length > 0) {
      throw malformed("JSON document ended before it was complete");
    }
    this.done = true;
    this.envelope();
  }

  envelope(): JsonObject {
    if (this.parsedEnvelope) return this.parsedEnvelope;
    let text = this.outside.text();
    if (!this.done) {
      // Inside the array every open container is an object on the path, so the
      // members read so far close cleanly; anywhere else the text is partial.
      if (this.phase !== "inside") throw new Error("The JSON envelope is not available until the streamed array starts");
      text += `]${"}".repeat(this.frames.length)}`;
    }
    if (text.trim() === "") throw malformed("JSON document is empty");
    let value: JsonValue;
    try {
      value = parseJson(text);
    } catch {
      throw malformed("JSON document is not valid JSON outside the streamed array");
    }
    const envelope = isJsonObject(value) ? value : {};
    if (this.done) this.parsedEnvelope = envelope;
    return envelope;
  }

  private atTarget(): boolean {
    return this.paths.some((path) => this.frames.length === path.length && this.frames.every((frame, index) => frame.object && !frame.expectsKey && frame.key === path[index]));
  }

  private finishKey(): void {
    this.capturingKey = false;
    const frame = this.frames.at(-1);
    if (!frame) return;
    let key: JsonValue;
    try {
      key = parseJson(this.key.text());
    } catch {
      throw malformed("JSON document has an invalid member name");
    }
    this.key.reset();
    frame.key = isJsonString(key) ? key : undefined;
    frame.expectsKey = false;
  }

  private finishElement(): JsonValue {
    const text = this.element.text();
    this.element.reset();
    this.elementOpen = false;
    try {
      return parseJson(text);
    } catch {
      throw malformed("JSON array element is not valid JSON");
    }
  }
}

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

function malformed(message: string): GatekeeperError {
  return new GatekeeperError(message, "invalid-response");
}

function tooLarge(message: string): GatekeeperError {
  return new GatekeeperError(message, "response-too-large");
}
