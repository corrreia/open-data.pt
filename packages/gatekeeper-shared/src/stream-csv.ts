import { GatekeeperError } from "./index";

/** How to read one delimited text stream. */
export interface CsvStreamOptions {
  /** Field delimiter. Detected from the first line (`,`, `;`, tab) when omitted. */
  delimiter?: string;
  /** Zero-based index of the header row; rows before it are skipped. Default 0. */
  headerRow?: number;
  /** Text encoding of the body. Default UTF-8 with a BOM stripped. */
  encoding?: "utf-8" | "latin1";
  /** Largest raw row accepted, in bytes. Default 1 MiB. */
  maxRowBytes?: number;
}

/** A delimited stream: its header once read, then one record per row. */
export interface CsvRecordStream {
  /** Resolves with the de-duplicated, trimmed header once the header row was read. */
  header: Promise<string[]>;
  /** Each data row keyed by header name, in file order. Short rows get empty strings. */
  records: AsyncIterable<Record<string, string>>;
}

const DEFAULT_ROW_BYTES = 1024 * 1024;
const DELIMITERS = [",", ";", "\t"] as const;

/** Windows-1252 code points for bytes 0x80..0x9F; every other byte maps to itself. */
const WINDOWS_1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d, 0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014,
  0x2dc, 0x2122, 0x161, 0x203a, 0x153, 0x9d, 0x17e, 0x178,
] as const;

/** Stream raw delimited rows (quotes and embedded newlines handled), header row included. */
export function streamCsvRows(body: ReadableStream<Uint8Array>, options?: CsvStreamOptions): AsyncIterable<string[]> {
  return csvRows(body, options ?? {});
}

/** Stream delimited records keyed by the header row. */
export function streamCsvRecords(body: ReadableStream<Uint8Array>, options?: CsvStreamOptions): CsvRecordStream {
  const rows = csvRows(body, options ?? {});
  const header = readHeader(rows);
  // The header is also awaited by `records`; a caller that never awaits it
  // directly must not see an unhandled rejection.
  header.catch(() => undefined);
  return { header, records: csvRecords(rows, header) };
}

async function readHeader(rows: AsyncGenerator<string[]>): Promise<string[]> {
  const first = await rows.next();
  return first.done ? [] : uniqueHeaders(first.value);
}

async function* csvRecords(rows: AsyncGenerator<string[]>, header: Promise<string[]>): AsyncGenerator<Record<string, string>> {
  const names = await header;
  try {
    while (true) {
      const next = await rows.next();
      if (next.done) return;
      const values = next.value;
      if (values.every((value) => value === "")) continue;
      yield Object.fromEntries(names.map((name, index) => [name, values[index] ?? ""]));
    }
  } finally {
    await rows.return(undefined);
  }
}

async function* csvRows(body: ReadableStream<Uint8Array>, options: CsvStreamOptions): AsyncGenerator<string[]> {
  const maxRowBytes = options.maxRowBytes ?? DEFAULT_ROW_BYTES;
  const headerRow = options.headerRow ?? 0;
  if (!Number.isSafeInteger(headerRow) || headerRow < 0) throw new Error("headerRow must be a non-negative integer");
  if (!Number.isSafeInteger(maxRowBytes) || maxRowBytes <= 0) throw new Error("maxRowBytes must be a positive integer");
  if (options.delimiter !== undefined && (options.delimiter.length !== 1 || /["\r\n]/.test(options.delimiter))) {
    throw new Error("delimiter must be one character other than a quote or line break");
  }
  const latin1 = options.encoding === "latin1";
  const decode = latin1 ? decodeWindows1252 : utf8Decoder();
  const measure = latin1 ? (_text: string, start: number, end: number) => end - start : utf8Length;
  let parser = options.delimiter === undefined ? undefined : new CsvParser(options.delimiter, maxRowBytes, measure);
  let prelude = "";
  let rowIndex = 0;

  const reader = body.getReader();
  let finished = false;
  try {
    while (true) {
      const part = await reader.read();
      const done = part.done;
      let text = done ? decode(new Uint8Array(0), false) : decode(part.value, true);
      if (!parser) {
        prelude += text;
        const detected = detectDelimiter(prelude, headerRow);
        if (!done && !detected.complete && prelude.length < maxRowBytes * (headerRow + 1)) continue;
        parser = new CsvParser(detected.delimiter, maxRowBytes, measure);
        text = prelude;
        prelude = "";
      }
      for (const row of parser.push(text)) {
        if (rowIndex >= headerRow) yield row;
        rowIndex += 1;
      }
      if (done) break;
    }
    finished = true;
    for (const row of parser?.finish() ?? []) {
      if (rowIndex >= headerRow) yield row;
      rowIndex += 1;
    }
  } finally {
    if (!finished) await reader.cancel("CSV stream closed early").catch(() => undefined);
    reader.releaseLock();
  }
}

/**
 * An incremental RFC 4180 parser: quoted fields may hold delimiters, doubled
 * quotes and line breaks; rows end at LF, CRLF or a lone CR. It keeps only the
 * row being read, and fails once that row exceeds its byte budget.
 */
class CsvParser {
  private field = "";
  private row: string[] = [];
  private quoted = false;
  /** A quote was read inside a quoted field: either a doubled quote or the closing one. */
  private quotePending = false;
  private pendingCarriageReturn = false;
  private atFieldStart = true;
  private rowStarted = false;
  private rowBytes = 0;

  constructor(
    private readonly delimiter: string,
    private readonly maxRowBytes: number,
    private readonly measure: (text: string, start: number, end: number) => number,
  ) {}

  *push(text: string): Generator<string[]> {
    const length = text.length;
    let index = 0;
    let rowStart = 0;
    while (index < length) {
      if (this.pendingCarriageReturn) {
        this.pendingCarriageReturn = false;
        if (text[index] === "\n") {
          index += 1;
          rowStart = index;
          continue;
        }
      }
      if (this.quotePending) {
        this.quotePending = false;
        if (text[index] === '"') {
          this.field += '"';
          index += 1;
          continue;
        }
        this.quoted = false;
      }
      if (this.quoted) {
        const close = text.indexOf('"', index);
        if (close < 0) {
          this.field += text.slice(index);
          index = length;
          break;
        }
        this.field += text.slice(index, close);
        index = close + 1;
        this.quotePending = true;
        continue;
      }
      const character = text[index];
      if (character === '"' && this.atFieldStart) {
        this.quoted = true;
        this.atFieldStart = false;
        this.rowStarted = true;
        index += 1;
        continue;
      }
      if (character === this.delimiter) {
        this.endField();
        this.rowStarted = true;
        index += 1;
        continue;
      }
      if (character === "\n" || character === "\r") {
        this.count(text, rowStart, index);
        yield this.endRow();
        if (character === "\r") this.pendingCarriageReturn = true;
        index += 1;
        rowStart = index;
        continue;
      }
      let end = index + 1;
      while (end < length) {
        const next = text[end];
        if (next === this.delimiter || next === "\n" || next === "\r") break;
        end += 1;
      }
      this.field += text.slice(index, end);
      this.atFieldStart = false;
      this.rowStarted = true;
      index = end;
    }
    this.count(text, rowStart, length);
  }

  *finish(): Generator<string[]> {
    if (this.quotePending) {
      this.quotePending = false;
      this.quoted = false;
    }
    if (this.quoted) throw new GatekeeperError("CSV ended inside a quoted field", "invalid-response");
    if (this.rowStarted || this.field !== "") yield this.endRow();
  }

  private count(text: string, start: number, end: number): void {
    this.rowBytes += this.measure(text, start, end);
    if (this.rowBytes > this.maxRowBytes) {
      throw new GatekeeperError(`CSV row exceeds ${this.maxRowBytes} bytes`, "response-too-large");
    }
  }

  private endField(): void {
    this.row.push(this.field);
    this.field = "";
    this.atFieldStart = true;
  }

  private endRow(): string[] {
    this.endField();
    const row = this.row;
    this.row = [];
    this.rowStarted = false;
    this.rowBytes = 0;
    return row;
  }
}

/** A delimiter guess, and whether the line it was read from was complete. */
interface DetectedDelimiter {
  delimiter: string;
  complete: boolean;
}

/**
 * The delimiter used most often outside quotes on the first line read, which
 * is the header row: preamble rows before it (a title, a blank line) are
 * skipped so they cannot decide the delimiter.
 */
function detectDelimiter(text: string, headerRow: number): DetectedDelimiter {
  const counts = new Map<string, number>(DELIMITERS.map((delimiter) => [delimiter, 0]));
  let quoted = false;
  let complete = false;
  let line = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      if (line === headerRow) {
        complete = true;
        break;
      }
      line += 1;
      continue;
    }
    if (line !== headerRow) continue;
    const seen = counts.get(character);
    if (seen !== undefined) counts.set(character, seen + 1);
  }
  let delimiter: string = DELIMITERS[0];
  for (const candidate of DELIMITERS) {
    if ((counts.get(candidate) ?? 0) > (counts.get(delimiter) ?? 0)) delimiter = candidate;
  }
  return { delimiter, complete };
}

/** Trimmed names, blanks named by position, repeats suffixed `_2`, `_3`, ... until unique. */
function uniqueHeaders(values: string[]): string[] {
  const taken = new Set<string>();
  return values.map((raw, index) => {
    const base = raw.replace(/^\uFEFF/, "").trim() || `column_${index + 1}`;
    let name = base;
    for (let suffix = 2; taken.has(name); suffix += 1) name = `${base}_${suffix}`;
    taken.add(name);
    return name;
  });
}

/** A streaming UTF-8 decoder: split characters are carried to the next chunk and a leading BOM is dropped. */
function utf8Decoder(): (bytes: Uint8Array, stream: boolean) => string {
  const decoder = new TextDecoder("utf-8");
  return (bytes, stream) => decoder.decode(bytes, { stream });
}

/** Single-byte decoding needs no state, so chunk boundaries never matter. */
function decodeWindows1252(bytes: Uint8Array): string {
  let text = "";
  const codes: number[] = [];
  for (let index = 0; index < bytes.byteLength; index += 1) {
    const byte = bytes[index]!;
    codes.push(byte >= 0x80 && byte <= 0x9f ? WINDOWS_1252_HIGH[byte - 0x80]! : byte);
    if (codes.length === 8192) {
      text += String.fromCharCode(...codes);
      codes.length = 0;
    }
  }
  return codes.length > 0 ? text + String.fromCharCode(...codes) : text;
}

/** Bytes a slice of decoded text took as UTF-8: exact for well-formed input. */
function utf8Length(text: string, start: number, end: number): number {
  let bytes = 0;
  for (let index = start; index < end; index += 1) {
    const code = text.charCodeAt(index);
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code >= 0xd800 && code <= 0xdfff ? 2 : 3;
  }
  return bytes;
}
