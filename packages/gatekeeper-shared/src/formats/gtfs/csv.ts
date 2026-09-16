import { GatekeeperError } from "../../index";

/** One GTFS CSV row keyed by its header names. Missing trailing values read as "". */
export type GtfsRow = Record<string, string>;

/** Largest row, in UTF-16 code units, held before failing; a runaway quote cannot eat memory. */
export const MAX_ROW_CHARACTERS = 1024 * 1024;

const QUOTE = 0x22;
const COMMA = 0x2c;
const LINE_FEED = 0x0a;
const CARRIAGE_RETURN = 0x0d;
const BYTE_ORDER_MARK = 0xfeff;

/**
 * Incremental RFC 4180 reader for UTF-8-decoded GTFS text: quoted commas and
 * newlines, doubled quotes, CRLF and a leading BOM. Push text as it decodes;
 * each call returns the rows that text completed. It holds at most one partial
 * row, whatever the file size.
 */
export class GtfsCsvReader {
  private header: string[] | undefined;
  private values: string[] = [];
  private field = "";
  private rowCharacters = 0;
  private quoted = false;
  /** A quote closed or escaped a quoted field, decided by the next character. */
  private quotePending = false;
  private skipLineFeed = false;
  private started = false;

  constructor(private readonly maximumRowCharacters = MAX_ROW_CHARACTERS) {}

  push(text: string): GtfsRow[] {
    const rows: GtfsRow[] = [];
    let index = 0;
    if (!this.started && text.length > 0) {
      this.started = true;
      if (text.charCodeAt(0) === BYTE_ORDER_MARK) index = 1;
    }
    while (index < text.length) {
      const code = text.charCodeAt(index);
      if (this.skipLineFeed) {
        this.skipLineFeed = false;
        if (code === LINE_FEED) {
          index += 1;
          continue;
        }
      }
      if (this.quoted) {
        if (this.quotePending) {
          this.quotePending = false;
          if (code === QUOTE) {
            this.append('"');
            index += 1;
          } else {
            // The quote closed the field; this character is read unquoted.
            this.quoted = false;
          }
          continue;
        }
        const end = text.indexOf('"', index);
        if (end === -1) {
          this.append(text.slice(index));
          break;
        }
        this.append(text.slice(index, end));
        this.quotePending = true;
        index = end + 1;
        continue;
      }
      let end = index;
      while (end < text.length) {
        const next = text.charCodeAt(end);
        if (next === COMMA || next === LINE_FEED || next === CARRIAGE_RETURN || next === QUOTE) break;
        end += 1;
      }
      if (end > index) this.append(text.slice(index, end));
      if (end === text.length) break;
      const delimiter = text.charCodeAt(end);
      index = end + 1;
      if (delimiter === QUOTE) {
        if (this.field.length !== 0) throw invalidCsv("Quote appeared inside an unquoted field");
        this.quoted = true;
      } else if (delimiter === COMMA) {
        this.endField();
      } else {
        this.endField();
        const row = this.endRow();
        if (row) rows.push(row);
        if (delimiter === CARRIAGE_RETURN) this.skipLineFeed = true;
      }
    }
    return rows;
  }

  /** The last row when the text did not end with a newline. */
  finish(): GtfsRow[] {
    if (this.quoted && !this.quotePending) throw invalidCsv("CSV ended inside a quoted field");
    this.quoted = false;
    this.quotePending = false;
    if (this.field.length === 0 && this.values.length === 0) return [];
    this.endField();
    const row = this.endRow();
    return row ? [row] : [];
  }

  private append(text: string): void {
    this.field += text;
    this.rowCharacters += text.length;
    if (this.rowCharacters > this.maximumRowCharacters) {
      throw invalidCsv(`Row exceeds ${this.maximumRowCharacters} characters`);
    }
  }

  private endField(): void {
    this.values.push(this.field);
    this.field = "";
  }

  private endRow(): GtfsRow | undefined {
    const values = this.values;
    this.values = [];
    this.rowCharacters = 0;
    if (!values.some((value) => value !== "")) return undefined;
    const header = this.header;
    if (!header) {
      // Some operator exports (TUB's shapes.txt) pad header names after commas.
      // GTFS field names contain no spaces; data cells remain untouched.
      const names = values.map((name) => name.trim());
      if (names.some((name) => name === "") || new Set(names).size !== names.length) {
        throw invalidCsv("CSV header names must be non-empty and unique");
      }
      this.header = names;
      return undefined;
    }
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? ""]));
  }
}

function invalidCsv(message: string): GatekeeperError {
  return new GatekeeperError(`Invalid GTFS CSV: ${message}`, "invalid-response");
}
