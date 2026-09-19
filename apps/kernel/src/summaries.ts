/**
 * Series summaries: every time-series point's value, bucketed and kept as one
 * JSON blob per product and Lisbon month in R2, rolled up again into one blob
 * per product and Lisbon year by month. A chart or client reading a long range
 * touches R2 alone, never the lake.
 *
 * The Registry builds them once a day in two passes, each one lake query
 * (paged) for every product at once: the lake is partitioned by ingest day
 * only, so a query costs the same whether it reads one product or all of them.
 *
 * - The fresh pass summarises each Lisbon day by UTC hour, a day after it
 *   ends, from the latest revision of the points ingested during it, the day
 *   after, and the days before it that a source may have published it in.
 * - The late pass takes each ingest day's points about older days: backfilled
 *   history, late publications, corrections. Days before the lake's first
 *   month are bucketed by Lisbon day (ten years by the hour would be millions
 *   of rows), later ones by hour. A point repeated within one ingest day counts
 *   once. A late bucket replaces the one it matches unless that one holds more
 *   points: a backfill walked twice is counted once, and a partial correction
 *   of a dense hour is left out. It streams product by product and stops when
 *   a wake's budget of R2 calls is spent; the next wake resumes after the last
 *   product it finished.
 *
 * A point published further ahead than `PUBLISHED_AHEAD_MS`, and never
 * republished within that window, reaches neither pass.
 */
import { asNumber, asString, isJsonObject, parseJson, type JsonObject, type JsonValue } from "@open-data-pt/gatekeeper-shared";
import type { ObjectStore } from "./object-store";
import { runLakeQuery } from "./query";
import { InvalidQueryError } from "./serving";

export const SUMMARY_TIME_ZONE = "Europe/Lisbon";
/** How long after a Lisbon day ends its points may still arrive; the day is summarised once this has passed. */
const INGEST_GRACE_MS = 24 * 3_600_000;
/**
 * How long before a point's own time it may have been published. Day-ahead
 * prices and load forecasts are ingested days before the hours they are about,
 * so a day's points are read from the ingest days around it, not only its own.
 * A source publishing further ahead than this keeps only what it republished
 * within the window.
 */
export const PUBLISHED_AHEAD_MS = 10 * 86_400_000;
/** Hourly buckets one product-month may hold; past this the month is kept by Lisbon day. */
const MAX_HOURLY_BUCKETS = 60_000;
/** Rows per page of the fresh pass. */
const FRESH_PAGE = 20_000;
/** Rows per page of the late pass; it keeps one product's rows and one page in memory. */
const LATE_PAGE = 30_000;
/** R2 reads and writes the late pass may spend in one Registry wake: well under the 10,000 subrequests a wake may make. */
const LATE_OP_BUDGET = 6_000;
/** R2 calls a year rebuild makes: twelve month reads and one write. */
const YEAR_REBUILD_OPS = 13;
/** R2 calls in flight at once while merging. */
const MERGE_CONCURRENCY = 8;
/** The first year of today's European clock-change rule, which Portugal follows. */
const DST_FROM_YEAR = 1996;
/** The late pass's Lisbon-day SQL names every clock change since 1996, so it runs longer than the API's own queries. */
const SUMMARY_SQL_CHARS = 8_000;
/** A range reads at most three years of month blobs; by month it reads year blobs instead. */
export const MAX_SUMMARY_MONTHS = 36;
/** A range by month reads at most this many year blobs. */
export const MAX_SUMMARY_YEARS = 50;
/** A range answer holds at most this many buckets across its series. */
export const MAX_SUMMARY_BUCKETS = 20_000;
/** A range names at most this many series. */
export const MAX_SUMMARY_SERIES = 10;
/** Ranges up to two weeks come back by the hour, up to three years by the day, longer by the month. */
const HOURLY_UP_TO_MS = 14 * 86_400_000;
const DAILY_UP_TO_MS = 1_100 * 86_400_000;

/** The Registry state key under which the next summary run is due. */
export const SUMMARY_DUE_STATE_KEY = "series-summary-due";
/** Fresh days summarised per Registry wake at most; a backlog catches up a minute at a time. */
export const SUMMARY_DAYS_PER_WAKE = 3;

const INDEX_KEY = "summaries/v1/index.json";
/** A product's month blob (`YYYY-MM`) or year blob (`YYYY`). */
export const summaryKey = (slug: string, period: string) => `summaries/v1/${slug}/${period}.json`;

export type SummaryResolution = "hour" | "day" | "month";

/** One bucket: its series, its start (UTC), and the count, mean, lowest and highest of the point values in it. */
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
  /** The Lisbon days holding buckets, oldest first. */
  days: string[];
  series: SummarySeries[];
  /** By start, then series key. */
  buckets: SummaryBucket[];
  updatedAt: string;
}

/** One product's summaries for one Lisbon year, by Lisbon month, rolled up from its month blobs. */
export interface SummaryYear {
  version: 1;
  product: string;
  year: string;
  timeZone: typeof SUMMARY_TIME_ZONE;
  resolution: "month";
  series: SummarySeries[];
  buckets: SummaryBucket[];
  updatedAt: string;
}

/** How far each pass has gone, for every product at once. */
export interface SummaryIndex {
  version: 1;
  /** The first day the fresh pass summarised: the lake's first ingest day. */
  firstDay: string;
  /** The last day the fresh pass summarised. */
  through: string;
  /** The oldest Lisbon day any summary holds, back into backfilled history. */
  earliestDay?: string | undefined;
  /** The last ingest day the late pass has finished. */
  lateThrough?: string | undefined;
  /** Within the ingest day after `lateThrough`: `day|slug` or `hour|slug`, the query and the last product finished. */
  lateCursor?: string | undefined;
  updatedAt: string;
}

/* ---------- Lisbon time ---------- */

export interface DayBounds {
  from: string;
  to: string;
}

const lisbonClock = new Intl.DateTimeFormat("en-CA", {
  timeZone: SUMMARY_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

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

/** Every Lisbon year an interval touches, oldest first. */
function yearsBetween(from: number, to: number): string[] {
  const years: string[] = [];
  const last = Number(lisbonDay(to - 1).slice(0, 4));
  for (let year = Number(lisbonDay(from).slice(0, 4)); year <= last; year += 1) years.push(String(year));
  return years;
}

/** The last Sunday of a month: Europe moves its clocks at 01:00 UTC on the last Sundays of March and October. */
function lastSunday(year: number, month: number): string {
  const day = new Date(Date.UTC(year, month, 0));
  while (day.getUTCDay() !== 0) day.setUTCDate(day.getUTCDate() - 1);
  return day.toISOString().slice(0, 10);
}

/** SQL for Lisbon's wall-clock time of `event_time`: an hour ahead of UTC in summer. R2 SQL has no time zones. */
function lisbonWallClockSql(fromYear: number, toYear: number): string {
  const summers: string[] = [];
  for (let year = fromYear; year <= toYear; year += 1) {
    summers.push(
      `WHEN event_time >= TIMESTAMP '${lastSunday(year, 3)}T01:00:00Z' AND event_time < TIMESTAMP '${lastSunday(year, 10)}T01:00:00Z' THEN event_time + INTERVAL '1 hour'`,
    );
  }
  return `CASE ${summers.join(" ")} ELSE event_time END`;
}

/** A function of a bucket start or a day, remembered: a month of buckets asks for the same few hundred. */
function remembered(compute: (key: string) => string): (key: string) => string {
  const known = new Map<string, string>();
  return (key) => {
    const held = known.get(key);
    if (held !== undefined) return held;
    const value = compute(key);
    if (known.size > 100_000) known.clear();
    known.set(key, value);
    return value;
  };
}
/** The Lisbon day a bucket starts in. */
const bucketDay = remembered((start) => lisbonDay(Date.parse(start)));
/** The instant a Lisbon day (YYYY-MM-DD) begins. */
const dayBegins = remembered((day) => new Date(lisbonMidnight(day)).toISOString());
const dayStart = (start: string) => dayBegins(bucketDay(start));
const monthStart = (start: string) => dayBegins(`${bucketDay(start).slice(0, 7)}-01`);

/* ---------- Buckets ---------- */

function combine(a: SummaryBucket, b: SummaryBucket): SummaryBucket {
  const count = a[2] + b[2];
  return [a[0], a[1], count, (a[3] * a[2] + b[3] * b[2]) / count, Math.min(a[4], b[4]), Math.max(a[5], b[5])];
}

// The start is a fixed-width timestamp at the end, so no two series and periods share an id.
const bucketId = (bucket: SummaryBucket) => `${bucket[0]}|${bucket[1]}`;

/** Buckets merged by series and by the period each one starts in. */
function rollUp(buckets: SummaryBucket[], periodStart: (start: string) => string): SummaryBucket[] {
  const merged = new Map<string, SummaryBucket>();
  for (const bucket of buckets) {
    const aligned: SummaryBucket = [bucket[0], periodStart(bucket[1]), bucket[2], bucket[3], bucket[4], bucket[5]];
    const id = bucketId(aligned);
    const current = merged.get(id);
    merged.set(id, current ? combine(current, aligned) : aligned);
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
  /** R2 calls the late pass may spend per wake; the default suits the Workers subrequest limit. */
  lateBudget?: number;
}

export interface SummaryRun {
  /** Fresh days summarised. */
  summarised: string[];
  /** Ingest days the late pass finished. */
  late: string[];
  bytesScanned: number;
  /** More work waits: the caller comes back soon rather than tomorrow. */
  backlog: boolean;
  /** When the next day will be settled. */
  nextDue: number;
}

/** Whether a Lisbon day is over and its late points are in. */
export function isSettled(day: string, now: number): boolean {
  return Date.parse(lisbonDayBounds(day).to) + INGEST_GRACE_MS <= now;
}

const dueAfter = (day: string) => Date.parse(lisbonDayBounds(day).to) + INGEST_GRACE_MS + 15 * 60_000;
const earlier = (a: string | undefined, b: string | undefined) => (a === undefined ? b : b === undefined || a <= b ? a : b);

/**
 * Summarises every settled fresh day not yet summarised, up to `maxDays`, then
 * works through the ingest days the late pass has not finished, up to
 * `maxLateDays`. Progress is saved after each step, so a wake cut short loses
 * nothing but the step it was in, and doing a step again changes nothing.
 */
export async function summariseSettledDays(deps: SummaryDeps, now: number, maxDays: number, maxLateDays = 1): Promise<SummaryRun> {
  const stored = await deps.objects.read<SummaryIndex>(INDEX_KEY);
  const firstDay = stored?.firstDay ?? (await lakeFirstDay(deps));
  if (!firstDay) return { summarised: [], late: [], bytesScanned: 0, backlog: false, nextDue: now + 86_400_000 };
  const updatedAt = new Date(now).toISOString();
  let bytesScanned = 0;

  const summarised: string[] = [];
  const years = new Set<string>();
  let day = stored ? addDays(stored.through, 1) : firstDay;
  while (summarised.length < maxDays && isSettled(day, now)) {
    const outcome = await summariseDay(deps, day, now);
    bytesScanned += outcome.bytesScanned;
    for (const slug of outcome.products) years.add(`${slug}|${day.slice(0, 4)}`);
    summarised.push(day);
    day = addDays(day, 1);
  }
  let index = stored;
  const through = summarised.at(-1);
  if (through) {
    await rebuildYears(deps.objects, years, now);
    index = { version: 1, firstDay, through, earliestDay: earlier(stored?.earliestDay, firstDay), lateThrough: stored?.lateThrough, lateCursor: stored?.lateCursor, updatedAt };
    await deps.objects.write<SummaryIndex>(INDEX_KEY, index);
  }

  // The late pass takes the wakes the fresh pass leaves alone, so no wake spends both passes' R2 calls.
  const late: string[] = [];
  let lateBacklog = false;
  let ingestDay = index?.lateThrough ? addDays(index.lateThrough, 1) : firstDay;
  const allowance: LateAllowance = { budget: deps.lateBudget ?? LATE_OP_BUDGET, spent: 0 };
  while (index && summarised.length === 0 && late.length < maxLateDays && allowance.spent < allowance.budget && isSettled(ingestDay, now)) {
    const outcome = await summariseLateDay(deps, ingestDay, firstDay, index.lateCursor, allowance, now);
    bytesScanned += outcome.bytesScanned;
    const earliestDay = earlier(index.earliestDay, outcome.earliestDay);
    if (!outcome.done) {
      index = { ...index, earliestDay, lateCursor: outcome.cursor, updatedAt };
      await deps.objects.write<SummaryIndex>(INDEX_KEY, index);
      lateBacklog = true;
      break;
    }
    index = { ...index, earliestDay, lateThrough: ingestDay, lateCursor: undefined, updatedAt };
    await deps.objects.write<SummaryIndex>(INDEX_KEY, index);
    late.push(ingestDay);
    ingestDay = addDays(ingestDay, 1);
  }

  return {
    summarised,
    late,
    bytesScanned,
    backlog: isSettled(day, now) || lateBacklog || (index !== undefined && isSettled(ingestDay, now)),
    nextDue: Math.min(dueAfter(day), dueAfter(ingestDay)),
  };
}

async function lakeFirstDay(deps: SummaryDeps): Promise<string | undefined> {
  const result = await runLakeQuery(deps.env, "SELECT MIN(__ingest_ts) AS first_ingest FROM open_data.points LIMIT 1", "summary:first-day", deps.fetcher);
  const first = asString(result.rows[0]?.first_ingest);
  return first ? lisbonDay(Date.parse(lakeTime(first))) : undefined;
}

/** One bucket as a lake query returns it, with the bucket time exactly as the lake wrote it for the next page's keyset. */
interface LakeBucket {
  product: string;
  bucket: SummaryBucket;
  series: SummarySeries;
  at: string;
}

type BucketColumn = "hour" | "day";

function lakeBucket(row: JsonObject, column: BucketColumn): LakeBucket | undefined {
  const product = asString(row.product_slug);
  const key = asString(row.series_key);
  const at = asString(row[column]);
  const count = asNumber(row.n);
  const mean = asNumber(row.mean);
  const min = asNumber(row.low);
  const max = asNumber(row.high);
  if (!product || key === undefined || !at || count === undefined || mean === undefined || min === undefined || max === undefined) return undefined;
  // A Lisbon-day bucket comes back as its wall-clock date at midnight; its start is that day's Lisbon midnight.
  const start = column === "hour" ? lakeTime(at) : dayBegins(at.slice(0, 10));
  return { product, at, bucket: [key, start, count, mean, min, max], series: { key, unit: asString(row.unit) ?? "", dimensions: lakeJson(asString(row.dimensions)) } };
}

/** The keyset that starts a page after the last row of the one before. */
function keyset(column: BucketColumn, last: LakeBucket | undefined): string {
  if (!last) return "";
  const product = quote(last.product);
  const key = quote(last.bucket[0]);
  return ` WHERE product_slug > '${product}' OR (product_slug = '${product}' AND series_key > '${key}') OR (product_slug = '${product}' AND series_key = '${key}' AND ${column} > TIMESTAMP '${last.at}')`;
}

/** One page of a summary query, parsed, with the bytes it scanned and whether more pages follow. */
interface LakePage {
  rows: LakeBucket[];
  bytesScanned: number;
  more: boolean;
}

async function lakePage(deps: SummaryDeps, label: string, page: number, column: BucketColumn, sql: string): Promise<LakePage> {
  const result = await runLakeQuery(deps.env, sql, label, deps.fetcher, page + 1, SUMMARY_SQL_CHARS);
  return { rows: result.rows.slice(0, page).flatMap((row) => lakeBucket(row, column) ?? []), bytesScanned: result.bytesScanned, more: result.rows.length > page };
}

/** A bucket's dimensions: any non-empty one. MAX alone compares the JSON as text, and `{}` sorts after `{"…`. */
const DIMENSIONS_SQL = "MAX(CASE WHEN dimensions IS NOT NULL AND dimensions != '' AND dimensions != '{}' THEN dimensions END)";

/** The latest revision of each point with an event time in the day, by series and UTC hour, whichever feed ID wrote it: a feed reinstalled under a new ID writes its points again. */
function freshSql(day: DayBounds, ingestFrom: string, ingestTo: string, last: LakeBucket | undefined): string {
  return `WITH ranked AS (SELECT product_slug, series_key, event_time, value, unit, dimensions, ROW_NUMBER() OVER (PARTITION BY product_slug, series_key, event_time ORDER BY observed_at DESC, revision_id DESC) AS rn FROM open_data.points WHERE __ingest_ts >= TIMESTAMP '${ingestFrom}' AND __ingest_ts < TIMESTAMP '${ingestTo}' AND event_time >= TIMESTAMP '${day.from}' AND event_time < TIMESTAMP '${day.to}'), buckets AS (SELECT product_slug, series_key, date_trunc('hour', event_time) AS hour, COUNT(*) AS n, AVG(value) AS mean, MIN(value) AS low, MAX(value) AS high, MAX(unit) AS unit, ${DIMENSIONS_SQL} AS dimensions FROM ranked WHERE rn = 1 GROUP BY product_slug, series_key, date_trunc('hour', event_time)) SELECT product_slug, series_key, hour, n, mean, low, high, unit, dimensions FROM buckets${keyset("hour", last)} ORDER BY product_slug, series_key, hour LIMIT ${FRESH_PAGE + 1}`;
}

const afterProduct = (slug: string | undefined) => (slug ? ` AND product_slug > '${quote(slug)}'` : "");

/** Points ingested in the day about the lake's own months, before the fresh pass's reach: by series and UTC hour. */
function lateHourlySql(ingest: DayBounds, from: string, before: string, slug: string | undefined, last: LakeBucket | undefined): string {
  return `WITH buckets AS (SELECT product_slug, series_key, date_trunc('hour', event_time) AS hour, COUNT(DISTINCT event_time) AS n, AVG(value) AS mean, MIN(value) AS low, MAX(value) AS high, MAX(unit) AS unit, ${DIMENSIONS_SQL} AS dimensions FROM open_data.points WHERE __ingest_ts >= TIMESTAMP '${ingest.from}' AND __ingest_ts < TIMESTAMP '${ingest.to}' AND event_time >= TIMESTAMP '${from}' AND event_time < TIMESTAMP '${before}'${afterProduct(slug)} GROUP BY product_slug, series_key, date_trunc('hour', event_time)) SELECT product_slug, series_key, hour, n, mean, low, high, unit, dimensions FROM buckets${keyset("hour", last)} ORDER BY product_slug, series_key, hour LIMIT ${LATE_PAGE + 1}`;
}

/** Points ingested in the day about days before the lake began: by series and Lisbon day. */
function lateDailySql(ingest: DayBounds, before: string, slug: string | undefined, last: LakeBucket | undefined): string {
  return `WITH shifted AS (SELECT product_slug, series_key, event_time, value, unit, dimensions, ${lisbonWallClockSql(DST_FROM_YEAR, Number(before.slice(0, 4)))} AS local_time FROM open_data.points WHERE __ingest_ts >= TIMESTAMP '${ingest.from}' AND __ingest_ts < TIMESTAMP '${ingest.to}' AND event_time < TIMESTAMP '${before}'${afterProduct(slug)}), buckets AS (SELECT product_slug, series_key, date_trunc('day', local_time) AS day, COUNT(DISTINCT event_time) AS n, AVG(value) AS mean, MIN(value) AS low, MAX(value) AS high, MAX(unit) AS unit, ${DIMENSIONS_SQL} AS dimensions FROM shifted GROUP BY product_slug, series_key, date_trunc('day', local_time)) SELECT product_slug, series_key, day, n, mean, low, high, unit, dimensions FROM buckets${keyset("day", last)} ORDER BY product_slug, series_key, day LIMIT ${LATE_PAGE + 1}`;
}

interface DayFound {
  buckets: SummaryBucket[];
  series: Map<string, SummarySeries>;
}

export interface FreshOutcome {
  bytesScanned: number;
  /** The products with points that day. */
  products: string[];
}

/** One Lisbon day of every product, into each product's month blob. */
export async function summariseDay(deps: SummaryDeps, day: string, now: number): Promise<FreshOutcome> {
  const bounds = lisbonDayBounds(day);
  const ingestTo = new Date(Date.parse(bounds.to) + INGEST_GRACE_MS).toISOString();
  // A day's points arrive from the day before it is published ahead until the grace after it ends.
  const ingestFrom = new Date(Date.parse(bounds.from) - PUBLISHED_AHEAD_MS).toISOString();
  const found = new Map<string, DayFound>();
  let bytesScanned = 0;
  let last: LakeBucket | undefined;
  for (let more = true; more;) {
    const page = await lakePage(deps, `summary:${day}`, FRESH_PAGE, "hour", freshSql(bounds, ingestFrom, ingestTo, last));
    bytesScanned += page.bytesScanned;
    for (const row of page.rows) {
      if (!deps.products.has(row.product)) continue;
      const product = found.get(row.product) ?? { buckets: [], series: new Map<string, SummarySeries>() };
      product.buckets.push(row.bucket);
      product.series.set(row.series.key, row.series);
      found.set(row.product, product);
    }
    more = page.more;
    last = page.rows.at(-1);
  }
  const month = day.slice(0, 7);
  await eachLimited([...found.entries()], ([slug, product]) =>
    mergeMonth(deps.objects, { slug, month, incoming: product.buckets, resolution: "hour", series: [...product.series.values()], rule: { kind: "replace-day", day } }, now),
  );
  return { bytesScanned, products: [...found.keys()] };
}

/** A whole product's rows from one late query, handed over once the query has moved past it. Returns false to stop. */
type ProductHandler = (slug: string, buckets: SummaryBucket[], series: Map<string, SummarySeries>) => Promise<boolean>;

interface ProductStream {
  bytesScanned: number;
  stopped: boolean;
}

/** A late query's rows, product by product: rows come ordered by product, so one product and one page are in memory at a time. */
async function eachProduct(
  deps: SummaryDeps,
  label: string,
  column: BucketColumn,
  sqlAfter: (last: LakeBucket | undefined) => string,
  take: ProductHandler,
): Promise<ProductStream> {
  let bytesScanned = 0;
  let last: LakeBucket | undefined;
  let slug: string | undefined;
  let buckets: SummaryBucket[] = [];
  let series = new Map<string, SummarySeries>();
  for (let more = true; more;) {
    const page = await lakePage(deps, label, LATE_PAGE, column, sqlAfter(last));
    bytesScanned += page.bytesScanned;
    for (const row of page.rows) {
      if (slug !== undefined && row.product !== slug) {
        if (!(await take(slug, buckets, series))) return { bytesScanned, stopped: true };
        buckets = [];
        series = new Map<string, SummarySeries>();
      }
      slug = row.product;
      buckets.push(row.bucket);
      series.set(row.series.key, row.series);
    }
    more = page.more;
    last = page.rows.at(-1);
  }
  if (slug !== undefined && !(await take(slug, buckets, series))) return { bytesScanned, stopped: true };
  return { bytesScanned, stopped: false };
}

/** The R2 calls one wake's late pass may make, and has made, across the ingest days it works through. */
export interface LateAllowance {
  budget: number;
  spent: number;
}

export interface LateOutcome {
  bytesScanned: number;
  /** Every product of the ingest day is merged. */
  done: boolean;
  /** When not done, where the next wake starts: `day|slug` or `hour|slug`. */
  cursor: string | undefined;
  earliestDay: string | undefined;
}

/**
 * One ingest day's points about older days, into the month blobs they belong
 * to and the year blobs above them: first the days before the lake's first
 * month by Lisbon day, then the lake's own older days by hour. Whole products
 * at a time, until the wake's allowance of R2 calls is spent; the wake's first
 * product goes through whatever it costs, so none is put off forever.
 */
export async function summariseLateDay(
  deps: SummaryDeps,
  ingestDay: string,
  firstDay: string,
  cursor: string | undefined,
  allowance: LateAllowance,
  now: number,
): Promise<LateOutcome> {
  const ingest = lisbonDayBounds(ingestDay);
  // The fresh pass covers each day from the lake's first on, from the ingest days it may have been published in; older days are the late pass's.
  const before = lisbonDayBounds(ingestDay === firstDay ? firstDay : addDays(ingestDay, -1)).from;
  const firstMonth = lisbonDayBounds(`${firstDay.slice(0, 7)}-01`).from;
  const dailyBefore = firstMonth < before ? firstMonth : before;
  const [stage, resumeAfter] = (cursor ?? "").split("|");
  const label = `summary-late:${ingestDay}`;
  let reached: string | undefined = cursor;
  let earliestDay: string | undefined;

  const merge =
    (resolution: BucketColumn): ProductHandler =>
    async (slug, buckets, series) => {
      if (!deps.products.has(slug)) return true;
      const updates = monthUpdates(slug, buckets, resolution, series);
      const years = new Set(updates.map((update) => `${slug}|${update.month.slice(0, 4)}`));
      const cost = updates.length * 2 + years.size * YEAR_REBUILD_OPS;
      if (allowance.spent > 0 && allowance.spent + cost > allowance.budget) return false;
      await eachLimited(updates, (update) => mergeMonth(deps.objects, update, now));
      await rebuildYears(deps.objects, years, now);
      allowance.spent += cost;
      reached = `${resolution}|${slug}`;
      for (const bucket of buckets) earliestDay = earlier(earliestDay, bucketDay(bucket[1]));
      return true;
    };

  let bytesScanned = 0;
  if (stage !== "hour") {
    const daily = await eachProduct(deps, label, "day", (last) => lateDailySql(ingest, dailyBefore, stage === "day" ? resumeAfter : undefined, last), merge("day"));
    bytesScanned += daily.bytesScanned;
    if (daily.stopped) return { bytesScanned, done: false, cursor: reached, earliestDay };
    reached = "hour|";
  }
  if (firstMonth < before) {
    const hourly = await eachProduct(deps, label, "hour", (last) => lateHourlySql(ingest, firstMonth, before, stage === "hour" ? resumeAfter : undefined, last), merge("hour"));
    bytesScanned += hourly.bytesScanned;
    if (hourly.stopped) return { bytesScanned, done: false, cursor: reached, earliestDay };
  }
  return { bytesScanned, done: true, cursor: undefined, earliestDay };
}

/** How incoming buckets meet a month's: the fresh pass replaces its whole day; the late pass replaces bucket by bucket. */
type MergeRule = { kind: "replace-day"; day: string } | { kind: "late" };

interface MonthUpdate {
  slug: string;
  month: string;
  incoming: SummaryBucket[];
  /** The buckets' own resolution: a month receiving any by day is kept by day. */
  resolution: "hour" | "day";
  series: SummarySeries[];
  rule: MergeRule;
}

function monthUpdates(slug: string, buckets: SummaryBucket[], resolution: "hour" | "day", series: Map<string, SummarySeries>): MonthUpdate[] {
  const byMonth = new Map<string, SummaryBucket[]>();
  for (const bucket of buckets) {
    const month = bucketDay(bucket[1]).slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(bucket);
    byMonth.set(month, list);
  }
  return [...byMonth.entries()].map(([month, incoming]) => ({ slug, month, incoming, resolution, series: [...series.values()], rule: { kind: "late" } }));
}

async function mergeMonth(objects: ObjectStore, update: MonthUpdate, now: number): Promise<void> {
  const key = summaryKey(update.slug, update.month);
  const existing = await objects.read<SummaryMonth>(key);
  const byDay = existing?.resolution === "day" || update.resolution === "day";
  const align = (buckets: SummaryBucket[]) => (byDay ? rollUp(buckets, dayStart) : buckets);
  const current = align(existing?.buckets ?? []);
  const incoming = align(update.incoming);
  let buckets: SummaryBucket[];
  if (update.rule.kind === "replace-day") {
    const day = update.rule.day;
    buckets = [...current.filter((bucket) => bucketDay(bucket[1]) !== day), ...incoming];
  } else {
    // A late bucket replaces the one it matches unless that one holds more points.
    const merged = new Map(current.map((bucket) => [bucketId(bucket), bucket]));
    for (const bucket of incoming) {
      const held = merged.get(bucketId(bucket));
      if (!held || held[2] <= bucket[2]) merged.set(bucketId(bucket), bucket);
    }
    buckets = [...merged.values()];
  }
  const hourly = !byDay && buckets.length <= MAX_HOURLY_BUCKETS;
  if (!byDay && !hourly) buckets = rollUp(buckets, dayStart);

  const series = new Map((existing?.series ?? []).map((each) => [each.key, each]));
  for (const each of update.series) {
    const held = series.get(each.key);
    series.set(each.key, { key: each.key, unit: each.unit || held?.unit || "", dimensions: hasFields(each.dimensions) ? each.dimensions : (held?.dimensions ?? {}) });
  }
  await objects.write<SummaryMonth>(key, {
    version: 1,
    product: update.slug,
    month: update.month,
    timeZone: SUMMARY_TIME_ZONE,
    resolution: hourly ? "hour" : "day",
    days: [...new Set(buckets.map((bucket) => bucketDay(bucket[1])))].sort(),
    series: [...series.values()].sort((a, b) => a.key.localeCompare(b.key)),
    buckets: buckets.sort(byStartThenKey),
    updatedAt: new Date(now).toISOString(),
  });
}

/** Each `slug|year` rebuilt from that year's month blobs, by Lisbon month. */
async function rebuildYears(objects: ObjectStore, years: Iterable<string>, now: number): Promise<void> {
  await eachLimited([...years], async (id) => {
    const [slug = "", year = ""] = id.split("|");
    const months = Array.from({ length: 12 }, (_, index) => `${year}-${String(index + 1).padStart(2, "0")}`);
    const blobs = (await mapLimited(months, (month) => objects.read<SummaryMonth>(summaryKey(slug, month)))).flatMap((blob) => blob ?? []);
    if (blobs.length === 0) return;
    const series = new Map<string, SummarySeries>();
    for (const blob of blobs) for (const each of blob.series) series.set(each.key, each);
    await objects.write<SummaryYear>(summaryKey(slug, year), {
      version: 1,
      product: slug,
      year,
      timeZone: SUMMARY_TIME_ZONE,
      resolution: "month",
      series: [...series.values()].sort((a, b) => a.key.localeCompare(b.key)),
      buckets: rollUp(
        blobs.flatMap((blob) => blob.buckets),
        monthStart,
      ).sort(byStartThenKey),
      updatedAt: new Date(now).toISOString(),
    });
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

export interface SummaryCoverage {
  /** The oldest Lisbon day any summary holds. */
  firstDay: string | null;
  /** The last Lisbon day summarised. */
  through: string | null;
  /** The instant that day ends: after it, points are in the live window only. */
  until: string | null;
}

export interface SummaryRange {
  resolution: SummaryResolution;
  timeZone: typeof SUMMARY_TIME_ZONE;
  from: string;
  to: string;
  coverage: SummaryCoverage;
  series: RangeSeries[];
}

export function autoResolution(spanMs: number): SummaryResolution {
  return spanMs <= HOURLY_UP_TO_MS ? "hour" : spanMs <= DAILY_UP_TO_MS ? "day" : "month";
}

/** A product's summaries between two instants: by hour or Lisbon day from month blobs, by Lisbon month from year blobs. */
export async function readSummaryRange(objects: ObjectStore, slug: string, query: RangeQuery): Promise<SummaryRange> {
  const from = Date.parse(query.from);
  const to = Date.parse(query.to);
  if (!(from < to)) throw new InvalidQueryError("from must be before to");
  if (query.seriesKeys.length > MAX_SUMMARY_SERIES) throw new InvalidQueryError(`Name at most ${MAX_SUMMARY_SERIES} series with seriesKey`);
  const index = await objects.read<SummaryIndex>(INDEX_KEY);
  const firstDay = index ? (index.earliestDay ?? index.firstDay) : undefined;
  // Only the periods with summaries are read: a range reaching back before any history reads nothing for those years.
  const readFrom = firstDay ? Math.max(from, Date.parse(lisbonDayBounds(firstDay).from)) : to;
  const readTo = index ? Math.min(to, Date.parse(lisbonDayBounds(index.through).to)) : from;

  const wanted = new Set(query.seriesKeys);
  const inRange = (blobs: Array<SummaryMonth | SummaryYear>) =>
    blobs
      .flatMap((blob) => blob.buckets)
      .filter((bucket) => {
        const start = Date.parse(bucket[1]);
        return start >= from && start < to && (wanted.size === 0 || wanted.has(bucket[0]));
      });
  let resolution = query.resolution ?? autoResolution(to - from);
  let blobs: Array<SummaryMonth | SummaryYear> = [];
  // Asked for no resolution, a range reaching far before a short history is answered as the history's own span would be.
  let fitted = false;
  let monthsFrom = readFrom;
  if (resolution === "month") {
    const years = readFrom < readTo ? yearsBetween(readFrom, readTo) : [];
    if (years.length > MAX_SUMMARY_YEARS)
      throw new InvalidQueryError(`A summary range by month spans at most ${MAX_SUMMARY_YEARS} years of data; read a longer span one window at a time`);
    blobs = (await mapLimited(years, (year) => objects.read<SummaryYear>(summaryKey(slug, year)))).flatMap((blob) => blob ?? []);
    const first = earliestStart(inRange(blobs));
    if (query.resolution === undefined && first < to && autoResolution(to - first) !== "month") {
      fitted = true;
      resolution = autoResolution(to - first);
      monthsFrom = Math.max(readFrom, first);
    }
  }
  if (resolution !== "month") {
    const months = monthsFrom < readTo ? monthsBetween(monthsFrom, readTo) : [];
    if (months.length > MAX_SUMMARY_MONTHS)
      throw new InvalidQueryError(
        `A summary range by ${resolution} spans at most ${MAX_SUMMARY_MONTHS} months of data; ask for resolution=month, or read a longer span one window at a time`,
      );
    const monthBlobs = (await mapLimited(months, (month) => objects.read<SummaryMonth>(summaryKey(slug, month)))).flatMap((blob) => blob ?? []);
    // A year knows only the month its history begins in; the months know the hour.
    const firstHour = fitted ? earliestStart(inRange(monthBlobs)) : Infinity;
    if (firstHour < to) resolution = autoResolution(to - firstHour);
    if (resolution === "hour" && monthBlobs.some((blob) => blob.resolution === "day")) resolution = "day";
    blobs = monthBlobs;
  }

  const found = inRange(blobs);
  const buckets = resolution === "day" ? rollUp(found, dayStart) : found;
  if (buckets.length > MAX_SUMMARY_BUCKETS)
    throw new InvalidQueryError(`That is ${buckets.length} buckets, more than ${MAX_SUMMARY_BUCKETS}: name fewer series with seriesKey, or ask for a coarser resolution`);

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
    coverage: { firstDay: firstDay ?? null, through: index?.through ?? null, until: index ? lisbonDayBounds(index.through).to : null },
    series: [...bySeries.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([seriesKey, list]) => ({ seriesKey, unit: meta.get(seriesKey)?.unit ?? "", dimensions: meta.get(seriesKey)?.dimensions ?? {}, buckets: list })),
  };
}

/** When the earliest bucket starts, or Infinity when there is none. */
function earliestStart(buckets: SummaryBucket[]): number {
  let first = Infinity;
  for (const bucket of buckets) first = Math.min(first, Date.parse(bucket[1]));
  return first;
}

/** One product's month blob (`YYYY-MM`) or year blob (`YYYY`) exactly as stored, or undefined when there is none. */
export function readSummaryFile(objects: ObjectStore, slug: string, period: string): Promise<SummaryMonth | SummaryYear | undefined> {
  return objects.read<SummaryMonth | SummaryYear>(summaryKey(slug, period));
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

const hasFields = (value: JsonValue) => isJsonObject(value) && Object.keys(value).length > 0;

const quote = (value: string) => value.replaceAll("'", "''");

/** `work` over every item, a few at a time. */
async function eachLimited<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  await mapLimited(items, work);
}

/** `map` over every item, a few at a time, in order. */
async function mapLimited<T, R>(items: T[], map: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  const entries = items.entries();
  const worker = async () => {
    for (let next = entries.next(); !next.done; next = entries.next()) {
      const [index, item] = next.value;
      results[index] = await map(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(MERGE_CONCURRENCY, items.length) }, worker));
  return results;
}
