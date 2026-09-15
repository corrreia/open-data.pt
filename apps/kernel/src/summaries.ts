/**
 * Series summaries: the latest value of every time-series point, bucketed by
 * UTC hour and kept as one JSON blob per product and Lisbon month in R2. A
 * product-month too large for hours keeps one bucket per Lisbon day instead.
 *
 * The Registry builds them once a day with one lake query for every product
 * at once: the lake is partitioned by ingest day only, so a query costs the
 * same whether it reads one product or all of them. A chart or client reading
 * a long range then touches R2 alone, never the lake.
 *
 * A Lisbon day is summarised once, a day after it ends, from the points
 * ingested during it and the day after; a correction that arrives later does
 * not reach its summary. Products that republish their whole history carry
 * event times far from their ingest day and drop out on their own: their
 * current window already holds that history.
 */
import { asNumber, asString, parseJson, type JsonObject, type JsonValue } from "@open-data-pt/gatekeeper-shared";
import type { ObjectStore } from "./object-store";
import { runLakeQuery } from "./query";
import { InvalidQueryError } from "./serving";

export const SUMMARY_TIME_ZONE = "Europe/Lisbon";
/** How long after a Lisbon day ends its points may still arrive; the day is summarised once this has passed. */
const INGEST_GRACE_MS = 24 * 3_600_000;
/** Hourly buckets one product-month may hold; past this the month is kept by Lisbon day. */
const MAX_HOURLY_BUCKETS = 60_000;
/** Rows per lake query page while summarising a day. */
const SUMMARY_PAGE = 20_000;
/** A range reads at most three years of months; longer spans are read one window at a time. */
export const MAX_SUMMARY_MONTHS = 36;
/** A range answer holds at most this many buckets across its series. */
export const MAX_SUMMARY_BUCKETS = 20_000;
/** A range names at most this many series. */
export const MAX_SUMMARY_SERIES = 10;
/** Ranges up to two weeks come back by the hour, up to three years by the day, longer by the month. */
const HOURLY_UP_TO_MS = 14 * 86_400_000;
const DAILY_UP_TO_MS = 1_100 * 86_400_000;

/** The Registry state key under which the next summary run is due. */
export const SUMMARY_DUE_STATE_KEY = "series-summary-due";
/** Days summarised per Registry wake at most; a backlog catches up a minute at a time. */
export const SUMMARY_DAYS_PER_WAKE = 3;

const INDEX_KEY = "summaries/v1/index.json";
export const summaryKey = (slug: string, month: string) => `summaries/v1/${slug}/${month}.json`;

export type SummaryResolution = "hour" | "day" | "month";

/** One bucket: its series, its start (UTC), and the count, mean, lowest and highest of the latest point values in it. */
export type SummaryBucket = [seriesKey: string, start: string, count: number, mean: number, min: number, max: number];

export interface SummarySeries {
  key: string;
  unit: string;
  dimensions: JsonValue;
}

/** One product's summaries for one Lisbon month: the public, versioned blob. */
export interface SummaryMonth {
  version: 1;
  product: string;
  month: string;
  timeZone: typeof SUMMARY_TIME_ZONE;
  resolution: "hour" | "day";
  /** The Lisbon days summarised so far, oldest first. */
  days: string[];
  series: SummarySeries[];
  /** By start, then series key. */
  buckets: SummaryBucket[];
  updatedAt: string;
}

/** Which Lisbon days have been summarised, for every product at once. */
export interface SummaryIndex {
  version: 1;
  firstDay: string;
  through: string;
  updatedAt: string;
}

/* ---------- Lisbon time ---------- */

export interface DayBounds {
  from: string;
  to: string;
}

const lisbonClock = new Intl.DateTimeFormat("en-CA", { timeZone: SUMMARY_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });

/** Lisbon's wall-clock time at an instant, written as if it were UTC. */
function wallClock(instant: number): number {
  const parts = lisbonClock.formatToParts(instant);
  const part = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find((each) => each.type === type)?.value ?? 0);
  return Date.UTC(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
}

/** The Lisbon calendar day an instant falls in, as YYYY-MM-DD. */
export function lisbonDay(instant: number): string {
  return new Date(wallClock(instant)).toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** The UTC instant a Lisbon calendar day begins. */
function lisbonMidnight(day: string): number {
  const utcMidnight = Date.parse(`${day}T00:00:00Z`);
  // Lisbon changes its clock at 01:00 UTC, never around midnight, so the offset an hour before midnight holds at midnight.
  const offset = wallClock(utcMidnight - 3_600_000) - (utcMidnight - 3_600_000);
  return utcMidnight - offset;
}

/** The UTC instants a Lisbon calendar day starts and ends at: 23 or 25 hours apart on the days the clocks change. */
export function lisbonDayBounds(day: string): DayBounds {
  return { from: new Date(lisbonMidnight(day)).toISOString(), to: new Date(lisbonMidnight(addDays(day, 1))).toISOString() };
}

function nextMonth(month: string): string {
  const [year = 1970, number = 1] = month.split("-").map(Number);
  return new Date(Date.UTC(year, number, 1)).toISOString().slice(0, 7);
}

/** Every Lisbon month an interval touches, oldest first. */
function monthsBetween(from: number, to: number): string[] {
  const months: string[] = [];
  const last = lisbonDay(to - 1).slice(0, 7);
  for (let month = lisbonDay(from).slice(0, 7); month <= last; month = nextMonth(month)) months.push(month);
  return months;
}

const dayStarts = new Map<string, string>();
/** The start of the Lisbon day a bucket starts in, remembered: a month of hours asks for the same few hundred. */
function dayStart(start: string): string {
  const known = dayStarts.get(start);
  if (known) return known;
  const value = lisbonDayBounds(lisbonDay(Date.parse(start))).from;
  if (dayStarts.size > 100_000) dayStarts.clear();
  dayStarts.set(start, value);
  return value;
}
const monthStart = (start: string) => lisbonDayBounds(`${lisbonDay(Date.parse(start)).slice(0, 7)}-01`).from;

/* ---------- Buckets ---------- */

function combine(a: SummaryBucket, b: SummaryBucket): SummaryBucket {
  const count = a[2] + b[2];
  return [a[0], a[1], count, (a[3] * a[2] + b[3] * b[2]) / count, Math.min(a[4], b[4]), Math.max(a[5], b[5])];
}

/** Buckets merged by series and by the period each one starts in. */
function rollUp(buckets: SummaryBucket[], periodStart: (start: string) => string): SummaryBucket[] {
  const merged = new Map<string, SummaryBucket>();
  for (const bucket of buckets) {
    const start = periodStart(bucket[1]);
    // The start is a fixed-width timestamp at the end, so no two series and periods share an id.
    const id = `${bucket[0]}|${start}`;
    const current = merged.get(id);
    merged.set(id, current ? combine(current, [bucket[0], start, bucket[2], bucket[3], bucket[4], bucket[5]]) : [bucket[0], start, bucket[2], bucket[3], bucket[4], bucket[5]]);
  }
  return [...merged.values()];
}

const byStartThenKey = (a: SummaryBucket, b: SummaryBucket) => a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]);

/* ---------- Building: once a day, from the lake ---------- */

export interface SummaryDeps {
  env: Pick<Env, "CATALOG_TOKEN" | "LAKE_BUCKET" | "CLOUDFLARE_ACCOUNT_ID">;
  objects: ObjectStore;
  /** The time-series products whose history is public, by slug; the lake holds no others worth summarising. */
  products: ReadonlySet<string>;
  fetcher?: typeof fetch;
}

export interface SummaryRun {
  summarised: string[];
  bytesScanned: number;
  /** More settled days wait: the caller comes back soon rather than tomorrow. */
  backlog: boolean;
  /** When the next day will be settled. */
  nextDue: number;
}

/** Whether a Lisbon day is over and its late points are in. */
export function isSettled(day: string, now: number): boolean {
  return Date.parse(lisbonDayBounds(day).to) + INGEST_GRACE_MS <= now;
}

/** Summarises every settled day not yet summarised, up to `maxDays` of them, oldest first. */
export async function summariseSettledDays(deps: SummaryDeps, now: number, maxDays: number): Promise<SummaryRun> {
  const index = await deps.objects.read<SummaryIndex>(INDEX_KEY);
  const firstDay = index?.firstDay ?? (await lakeFirstDay(deps));
  if (!firstDay) return { summarised: [], bytesScanned: 0, backlog: false, nextDue: now + 86_400_000 };
  let day = index ? addDays(index.through, 1) : firstDay;
  const summarised: string[] = [];
  let bytesScanned = 0;
  while (summarised.length < maxDays && isSettled(day, now)) {
    bytesScanned += await summariseDay(deps, day, now);
    summarised.push(day);
    await deps.objects.write<SummaryIndex>(INDEX_KEY, { version: 1, firstDay, through: day, updatedAt: new Date(now).toISOString() });
    day = addDays(day, 1);
  }
  return { summarised, bytesScanned, backlog: isSettled(day, now), nextDue: Date.parse(lisbonDayBounds(day).to) + INGEST_GRACE_MS + 15 * 60_000 };
}

async function lakeFirstDay(deps: SummaryDeps): Promise<string | undefined> {
  const result = await runLakeQuery(deps.env, "SELECT MIN(__ingest_ts) AS first_ingest FROM open_data.points LIMIT 1", "summary:first-day", deps.fetcher);
  const first = asString(result.rows[0]?.first_ingest);
  return first ? lisbonDay(Date.parse(lakeTime(first))) : undefined;
}

interface LakeBucket {
  product: string;
  bucket: SummaryBucket;
  series: SummarySeries;
}

interface DayFound {
  buckets: SummaryBucket[];
  series: Map<string, SummarySeries>;
}

/** One Lisbon day of every product, into each product's month blob. Returns the bytes the lake scanned. */
export async function summariseDay(deps: SummaryDeps, day: string, now: number): Promise<number> {
  const bounds = lisbonDayBounds(day);
  const ingestTo = new Date(Date.parse(bounds.to) + INGEST_GRACE_MS).toISOString();
  const found = new Map<string, DayFound>();
  let bytesScanned = 0;
  let after: LakeBucket | undefined;
  for (;;) {
    const result = await runLakeQuery(deps.env, daySql(bounds, ingestTo, after), `summary:${day}`, deps.fetcher, SUMMARY_PAGE + 1);
    bytesScanned += result.bytesScanned;
    const page = result.rows.slice(0, SUMMARY_PAGE).flatMap((row) => lakeBucket(row) ?? []);
    for (const row of page) {
      if (!deps.products.has(row.product)) continue;
      const product = found.get(row.product) ?? { buckets: [], series: new Map<string, SummarySeries>() };
      product.buckets.push(row.bucket);
      product.series.set(row.series.key, row.series);
      found.set(row.product, product);
    }
    if (result.rows.length <= SUMMARY_PAGE) break;
    after = page.at(-1);
  }
  for (const [slug, product] of found) await mergeDay(deps.objects, slug, day, product, now);
  return bytesScanned;
}

/** The latest revision of each point with an event time in the day, bucketed per series and UTC hour, paged by series and hour. */
function daySql(bounds: DayBounds, ingestTo: string, after: LakeBucket | undefined): string {
  const keyset = after
    ? ` WHERE product_slug > '${quote(after.product)}' OR (product_slug = '${quote(after.product)}' AND series_key > '${quote(after.bucket[0])}') OR (product_slug = '${quote(after.product)}' AND series_key = '${quote(after.bucket[0])}' AND hour > TIMESTAMP '${after.bucket[1]}')`
    : "";
  return `WITH ranked AS (SELECT product_slug, series_key, event_time, value, unit, dimensions, ROW_NUMBER() OVER (PARTITION BY feed_id, product_slug, series_key, event_time ORDER BY observed_at DESC, revision_id DESC) AS rn FROM open_data.points WHERE __ingest_ts >= TIMESTAMP '${bounds.from}' AND __ingest_ts < TIMESTAMP '${ingestTo}' AND event_time >= TIMESTAMP '${bounds.from}' AND event_time < TIMESTAMP '${bounds.to}'), buckets AS (SELECT product_slug, series_key, date_trunc('hour', event_time) AS hour, COUNT(*) AS n, AVG(value) AS mean, MIN(value) AS low, MAX(value) AS high, MAX(unit) AS unit, MAX(dimensions) AS dimensions FROM ranked WHERE rn = 1 GROUP BY product_slug, series_key, date_trunc('hour', event_time)) SELECT product_slug, series_key, hour, n, mean, low, high, unit, dimensions FROM buckets${keyset} ORDER BY product_slug, series_key, hour LIMIT ${SUMMARY_PAGE + 1}`;
}

function lakeBucket(row: JsonObject): LakeBucket | undefined {
  const product = asString(row.product_slug);
  const key = asString(row.series_key);
  const hour = asString(row.hour);
  const count = asNumber(row.n);
  const mean = asNumber(row.mean);
  const min = asNumber(row.low);
  const max = asNumber(row.high);
  if (!product || key === undefined || !hour || count === undefined || mean === undefined || min === undefined || max === undefined) return undefined;
  return { product, bucket: [key, lakeTime(hour), count, mean, min, max], series: { key, unit: asString(row.unit) ?? "", dimensions: lakeJson(asString(row.dimensions)) } };
}

/** The day's buckets replace whatever the month held for that day, so summarising a day again never counts it twice. */
async function mergeDay(objects: ObjectStore, slug: string, day: string, found: DayFound, now: number): Promise<void> {
  const month = day.slice(0, 7);
  const key = summaryKey(slug, month);
  const existing = await objects.read<SummaryMonth>(key);
  const kept = (existing?.buckets ?? []).filter((bucket) => lisbonDay(Date.parse(bucket[1])) !== day);
  const hourly = (existing?.resolution ?? "hour") === "hour" && kept.length + found.buckets.length <= MAX_HOURLY_BUCKETS;
  const buckets = hourly ? [...kept, ...found.buckets] : [...rollUp(kept, dayStart), ...rollUp(found.buckets, dayStart)];
  const series = new Map((existing?.series ?? []).map((each) => [each.key, each]));
  for (const [seriesKey, each] of found.series) series.set(seriesKey, each);
  await objects.write<SummaryMonth>(key, {
    version: 1,
    product: slug,
    month,
    timeZone: SUMMARY_TIME_ZONE,
    resolution: hourly ? "hour" : "day",
    days: [...new Set([...(existing?.days ?? []), day])].sort(),
    series: [...series.values()].sort((a, b) => a.key.localeCompare(b.key)),
    buckets: buckets.sort(byStartThenKey),
    updatedAt: new Date(now).toISOString(),
  });
}

/* ---------- Reading: any range, from R2 alone ---------- */

export interface RangeQuery {
  from: string;
  to: string;
  resolution?: SummaryResolution | undefined;
  seriesKeys: string[];
}

export interface RangeBucket {
  start: string;
  count: number;
  mean: number;
  min: number;
  max: number;
}

export interface RangeSeries {
  seriesKey: string;
  unit: string;
  dimensions: JsonValue;
  buckets: RangeBucket[];
}

export interface SummaryRange {
  resolution: SummaryResolution;
  timeZone: typeof SUMMARY_TIME_ZONE;
  from: string;
  to: string;
  /** The first and last Lisbon days summarised; nothing outside them is in any answer. */
  coverage: { firstDay: string | null; through: string | null };
  series: RangeSeries[];
}

export function autoResolution(spanMs: number): SummaryResolution {
  return spanMs <= HOURLY_UP_TO_MS ? "hour" : spanMs <= DAILY_UP_TO_MS ? "day" : "month";
}

/** A product's summaries between two instants, by hour, Lisbon day or Lisbon month. */
export async function readSummaryRange(objects: ObjectStore, slug: string, query: RangeQuery): Promise<SummaryRange> {
  const from = Date.parse(query.from);
  const to = Date.parse(query.to);
  if (!(from < to)) throw new InvalidQueryError("from must be before to");
  if (query.seriesKeys.length > MAX_SUMMARY_SERIES) throw new InvalidQueryError(`Name at most ${MAX_SUMMARY_SERIES} series with seriesKey`);
  const index = await objects.read<SummaryIndex>(INDEX_KEY);
  // Only the months with summaries are read: a range reaching back before the lake reads nothing for those years.
  const readFrom = index ? Math.max(from, Date.parse(lisbonDayBounds(index.firstDay).from)) : to;
  const readTo = index ? Math.min(to, Date.parse(lisbonDayBounds(index.through).to)) : from;
  const months = readFrom < readTo ? monthsBetween(readFrom, readTo) : [];
  if (months.length > MAX_SUMMARY_MONTHS) throw new InvalidQueryError(`A summary range spans at most ${MAX_SUMMARY_MONTHS} months of data; read a longer span one window at a time`);
  const blobs = (await Promise.all(months.map((month) => objects.read<SummaryMonth>(summaryKey(slug, month))))).flatMap((blob) => blob ?? []);

  let resolution = query.resolution ?? autoResolution(to - from);
  if (resolution === "hour" && blobs.some((blob) => blob.resolution === "day")) resolution = "day";
  const wanted = new Set(query.seriesKeys);
  const inRange = blobs.flatMap((blob) => blob.buckets).filter((bucket) => {
    const start = Date.parse(bucket[1]);
    return start >= from && start < to && (wanted.size === 0 || wanted.has(bucket[0]));
  });
  const buckets = resolution === "hour" ? inRange : rollUp(inRange, resolution === "day" ? dayStart : monthStart);
  if (buckets.length > MAX_SUMMARY_BUCKETS) throw new InvalidQueryError(`That is ${buckets.length} buckets, more than ${MAX_SUMMARY_BUCKETS}: name fewer series with seriesKey, or ask for a coarser resolution`);

  const meta = new Map<string, SummarySeries>();
  for (const blob of blobs) for (const each of blob.series) meta.set(each.key, each);
  const bySeries = new Map<string, RangeBucket[]>();
  for (const bucket of buckets.sort(byStartThenKey)) {
    const list = bySeries.get(bucket[0]) ?? [];
    list.push({ start: bucket[1], count: bucket[2], mean: bucket[3], min: bucket[4], max: bucket[5] });
    bySeries.set(bucket[0], list);
  }
  return {
    resolution,
    timeZone: SUMMARY_TIME_ZONE,
    from: new Date(from).toISOString(),
    to: new Date(to).toISOString(),
    coverage: { firstDay: index?.firstDay ?? null, through: index?.through ?? null },
    series: [...bySeries.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([seriesKey, list]) => ({ seriesKey, unit: meta.get(seriesKey)?.unit ?? "", dimensions: meta.get(seriesKey)?.dimensions ?? {}, buckets: list })),
  };
}

/** One product's month blob exactly as stored, or undefined when that month has none. */
export function readSummaryMonth(objects: ObjectStore, slug: string, month: string): Promise<SummaryMonth | undefined> {
  return objects.read<SummaryMonth>(summaryKey(slug, month));
}

/** Whether a Lisbon month is over and every day of it summarised a day later: its blob no longer changes. */
export function isClosedMonth(month: string, now: number): boolean {
  return isSettled(addDays(`${nextMonth(month)}-01`, -1), now);
}

/* ---------- Small helpers ---------- */

/** R2 SQL writes timestamps with microseconds; keep milliseconds, as everywhere else. */
function lakeTime(value: string): string {
  return new Date(value.replace(/(\.\d{3})\d+/, "$1")).toISOString();
}

function lakeJson(text: string | undefined): JsonValue {
  if (!text) return {};
  try {
    return parseJson(text);
  } catch {
    return {};
  }
}

const quote = (value: string) => value.replaceAll("'", "''");
