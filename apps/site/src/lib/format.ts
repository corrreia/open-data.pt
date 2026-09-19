import type { JsonValue } from "./types";

const isNumber = (value: JsonValue | undefined): value is number => Number.isFinite(value);

// Built once: constructing an Intl formatter costs far more than using one, and a page with
// hundreds of ticking relative times formats each of them every second.
const INTEGER = new Intl.NumberFormat();
const COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 2 });
const DECIMAL = new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 });
const DATE = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const TIME = new Intl.DateTimeFormat(undefined, { timeStyle: "short" });
const RELATIVE = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

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
    if (value === undefined || value === null || value === "") return "—";
    return DATE.format(new Date(value));
  },
  dateTime(value: string | number | undefined | null) {
    if (value === undefined || value === null || value === "") return "—";
    return DATE_TIME.format(new Date(value));
  },
  time(value: string | number | undefined | null) {
    if (value === undefined || value === null || value === "") return "—";
    return TIME.format(new Date(value));
  },
  relative(value: string | number | undefined | null, now = Date.now()) {
    if (value === undefined || value === null || value === "") return "—";
    const delta = (new Date(value).getTime() - now) / 1000;
    const abs = Math.abs(delta);
    if (abs < 5) return "just now";
    if (abs < 60) return RELATIVE.format(Math.round(delta), "second");
    if (abs < 3600) return RELATIVE.format(Math.round(delta / 60), "minute");
    if (abs < 86_400) return RELATIVE.format(Math.round(delta / 3600), "hour");
    if (abs < 86_400 * 30) return RELATIVE.format(Math.round(delta / 86_400), "day");
    return fmt.date(value);
  },
  countdown(value: string | undefined, now = Date.now()) {
    if (!value) return "not scheduled";
    const seconds = Math.round((new Date(value).getTime() - now) / 1000);
    if (seconds <= 0) return "due now";
    if (seconds < 90) return `in ${seconds} s`;
    if (seconds < 3600) return `in ${Math.round(seconds / 60)} min`;
    if (seconds < 86_400) return `in ${Math.round(seconds / 3600)} h`;
    return `in ${Math.round(seconds / 86_400)} d`;
  },
  /** "every minute", "every 24 h", "daily", "every 30 days" */
  every(seconds: number | undefined) {
    if (seconds === undefined || !Number.isFinite(seconds)) return "—";
    if (seconds < 60) return `every ${seconds} s`;
    if (seconds === 60) return "every minute";
    if (seconds < 3600) return `every ${Math.round(seconds / 60)} min`;
    if (seconds === 3600) return "every hour";
    if (seconds < 86_400) return `every ${Math.round(seconds / 3600)} h`;
    if (seconds === 86_400) return "daily";
    return `every ${Math.round(seconds / 86_400)} days`;
  },
  span(seconds: number | undefined | null) {
    if (seconds === null || seconds === undefined) return "kept indefinitely";
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    if (seconds < 86_400) return `${Math.round(seconds / 3600)} h`;
    const days = Math.round(seconds / 86_400);
    return `${days} ${days === 1 ? "day" : "days"}`;
  },
  /** "under a minute", "23 min", "3 h 5 min", "2 d 4 h" */
  duration(ms: number) {
    const minutes = Math.round(ms / 60_000);
    if (minutes < 1) return "under a minute";
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
    if (value === true || value === false) return value ? "true" : "false";
    const text = String(value);
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
  },
};

export function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value !== null && !Array.isArray(value) && Object.prototype.toString.call(value) === "[object Object]";
}

export function humanize(value: string) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\bid\b/gi, "ID")
    .replace(/^./, (c) => c.toUpperCase());
}

export const plural = (count: number, one: string, many = `${one}s`) => `${fmt.int(count)} ${count === 1 ? one : many}`;
