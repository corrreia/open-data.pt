import { FORMAT } from "../text/format";
import { INTL_LOCALE } from "./locale";
import type { JsonValue } from "./types";

/** A finite number as written, never one coerced from a string, null or anything else. */
export const isNumber = (value: JsonValue | undefined): value is number => Number.isFinite(value);

// Built once: constructing an Intl formatter costs far more than using one, and a page with
// hundreds of ticking relative times formats each of them every second.
const INTEGER = new Intl.NumberFormat(INTL_LOCALE);
const COMPACT = new Intl.NumberFormat(INTL_LOCALE, { notation: "compact", maximumFractionDigits: 2 });
const DECIMAL = new Intl.NumberFormat(INTL_LOCALE, { maximumFractionDigits: 4 });
const DATE = new Intl.DateTimeFormat(INTL_LOCALE, { dateStyle: "medium" });
const DATE_TIME = new Intl.DateTimeFormat(INTL_LOCALE, { dateStyle: "medium", timeStyle: "short" });
const TIME = new Intl.DateTimeFormat(INTL_LOCALE, { timeStyle: "short" });
const RELATIVE = new Intl.RelativeTimeFormat(INTL_LOCALE, { numeric: "auto" });

/**
 * A time as a reader sees it, or as the source wrote it. A source's own field can hold anything —
 * `2026-99-99T00:00` passes for a timestamp and is not a date — and `Intl` throws on one of those,
 * which would take the whole page down rather than show one odd value.
 */
function formatted(format: Intl.DateTimeFormat, value: string | number | undefined | null) {
  if (value === undefined || value === null || value === "") return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : format.format(date);
}

export const fmt = {
  int(value: number | null | undefined) {
    return value === null || value === undefined || !Number.isFinite(value) ? "—" : INTEGER.format(value);
  },
  compact(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    return COMPACT.format(value);
  },
  bytes(value: number | null | undefined) {
    if (value === null || value === undefined || !Number.isFinite(value)) return "—";
    if (value < 1024) return `${value} B`;
    if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
    if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
    return `${(value / 1024 ** 3).toFixed(2)} GB`;
  },
  date(value: string | number | undefined | null) {
    return formatted(DATE, value);
  },
  dateTime(value: string | number | undefined | null) {
    return formatted(DATE_TIME, value);
  },
  time(value: string | number | undefined | null) {
    return formatted(TIME, value);
  },
  relative(value: string | number | undefined | null, now = Date.now()) {
    if (value === undefined || value === null || value === "") return "—";
    const delta = (new Date(value).getTime() - now) / 1000;
    const abs = Math.abs(delta);
    if (abs < 5) return FORMAT.justNow;
    if (abs < 60) return RELATIVE.format(Math.round(delta), "second");
    if (abs < 3600) return RELATIVE.format(Math.round(delta / 60), "minute");
    if (abs < 86_400) return RELATIVE.format(Math.round(delta / 3600), "hour");
    if (abs < 86_400 * 30) return RELATIVE.format(Math.round(delta / 86_400), "day");
    return fmt.date(value);
  },
  countdown(value: string | undefined, now = Date.now()) {
    if (!value) return FORMAT.notScheduled;
    const seconds = Math.round((new Date(value).getTime() - now) / 1000);
    if (seconds <= 0) return FORMAT.dueNow;
    if (seconds < 90) return FORMAT.in(`${seconds} s`);
    if (seconds < 3600) return FORMAT.in(`${Math.round(seconds / 60)} min`);
    if (seconds < 86_400) return FORMAT.in(`${Math.round(seconds / 3600)} h`);
    return FORMAT.in(`${Math.round(seconds / 86_400)} d`);
  },
  /** "every minute", "every 24 h", "daily", "every 30 days" */
  every(seconds: number | undefined) {
    if (seconds === undefined || !Number.isFinite(seconds)) return "—";
    if (seconds < 60) return FORMAT.everyUnit(`${seconds} s`);
    if (seconds === 60) return FORMAT.everyMinute;
    if (seconds < 3600) return FORMAT.everyUnit(`${Math.round(seconds / 60)} min`);
    if (seconds === 3600) return FORMAT.everyHour;
    if (seconds < 86_400) return FORMAT.everyUnit(`${Math.round(seconds / 3600)} h`);
    if (seconds === 86_400) return FORMAT.daily;
    return FORMAT.everyDays(Math.round(seconds / 86_400));
  },
  span(seconds: number | undefined | null) {
    if (seconds === null || seconds === undefined) return FORMAT.keptIndefinitely;
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
    const days = Math.round(seconds / 86_400);
    return FORMAT.days(days);
  },
  /** "under a minute", "23 min", "3 h 5 min", "2 d 4 h" */
  duration(ms: number) {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 1) return FORMAT.underAMinute;
    if (minutes < 60) return `${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return minutes % 60 ? `${hours} h ${minutes % 60} min` : `${hours} h`;
    const days = Math.floor(hours / 24);
    return hours % 24 ? `${days} d ${hours % 24} h` : `${days} d`;
  },
  took(ms: number | null | undefined) {
    if (ms === null || ms === undefined) return "—";
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
  },
  /** A cell's text from its value and schema type. */
  cell(value: JsonValue | undefined, type?: string) {
    if (value === null || value === undefined || value === "") return "—";
    if (type === "datetime" || type === "date") return fmt.dateTime(String(value));
    if (type === "latitude" || type === "longitude") return Number(value).toFixed(5);
    if (Array.isArray(value) || (value !== null && isRecord(value))) {
      const text = JSON.stringify(value);
      return text.length > 60 ? `${text.slice(0, 57)}…` : text;
    }
    if (isNumber(value)) return DECIMAL.format(value);
    if (value === true || value === false) return value ? FORMAT.yes : FORMAT.no;
    const text = String(value);
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  },
};

export function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}

export function humanize(value: string) {
  return (
    value
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[_-]+/g, " ")
      // Whole words only, and a letter with an accent is part of a word: "éip" keeps its "ip".
      .replace(/(?<![\p{L}\p{N}])id(?![\p{L}\p{N}])/giu, "ID")
      .replace(/(?<![\p{L}\p{N}])ip(?![\p{L}\p{N}])/giu, "IP")
      .replace(/^./, (c) => c.toUpperCase())
  );
}

export const plural = (count: number, one: string, many = `${one}s`) => `${fmt.int(count)} ${count === 1 ? one : many}`;
