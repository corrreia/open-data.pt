import type { JsonObject } from "@open-data-pt/gatekeeper-shared";
import { describe, expect, it } from "vitest";
import { ObjectStore } from "../apps/kernel/src/object-store";
import {
  MAX_SUMMARY_BUCKETS,
  isClosedMonth,
  lisbonDay,
  lisbonDayBounds,
  readSummaryMonth,
  readSummaryRange,
  summariseDay,
  summariseSettledDays,
  summaryKey,
  type SummaryBucket,
  type SummaryMonth,
} from "../apps/kernel/src/summaries";
import { MemorySnapshots } from "./kernel-harness";

const env = { CATALOG_TOKEN: "token", LAKE_BUCKET: "history", CLOUDFLARE_ACCOUNT_ID: "account" };
const products = new Set(["power-series", "big-series"]);

/** R2 SQL writes microseconds. */
const lakeHour = (instant: number) => new Date(instant).toISOString().replace(".000Z", ".000000Z");

/** Three hours of one power series for a Lisbon day, and one row of a product the summaries leave out. */
function powerRows(day: string): JsonObject[] {
  const start = Date.parse(lisbonDayBounds(day).from);
  return [
    ...[0, 1, 2].map((hour) => ({ product_slug: "power-series", series_key: "consumption", hour: lakeHour(start + hour * 3_600_000), n: 4, mean: 100 + hour, low: 90 + hour, high: 110 + hour, unit: "MW", dimensions: '{"source":"Consumption"}' })),
    { product_slug: "private-series", series_key: "x", hour: lakeHour(start), n: 1, mean: 1, low: 1, high: 1, unit: "", dimensions: "{}" },
  ];
}

/** 2,600 series with a point every hour: more than a month of hours may hold. */
function bigRows(day: string): JsonObject[] {
  const start = Date.parse(lisbonDayBounds(day).from);
  const rows: JsonObject[] = [];
  for (let series = 0; series < 2_600; series += 1) {
    for (let hour = 0; hour < 24; hour += 1) rows.push({ product_slug: "big-series", series_key: `s${String(series).padStart(4, "0")}`, hour: lakeHour(start + hour * 3_600_000), n: 1, mean: hour, low: hour, high: hour, unit: "°C", dimensions: "{}" });
  }
  return rows;
}

/** A row's place in R2 SQL's order: product, series, then hour (milliseconds, as the keyset carries it). */
const order = (row: JsonObject) => `${String(row.product_slug)}|${String(row.series_key)}|${String(row.hour).replace(/(\.\d{3})\d+/, "$1")}`;

/** A lake that answers the first-ingest probe and each day's query, paging by product, series and hour as R2 SQL would. */
function fakeLake(rowsFor: (day: string) => JsonObject[]) {
  const queries: string[] = [];
  const days = new Map<string, Array<{ key: string; row: JsonObject }>>();
  const fetcher: typeof fetch = async (_input, init) => {
    // SAFETY: runLakeQuery always posts `{ query }` as its JSON body.
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    queries.push(query);
    if (query.includes("MIN(__ingest_ts)")) return Response.json({ success: true, result: { rows: [{ first_ingest: "2026-09-09T10:00:00.000000Z" }], metrics: { bytes_scanned: 10 } } });
    const day = lisbonDay(Date.parse(/event_time >= TIMESTAMP '([^']+)'/.exec(query)?.[1] ?? ""));
    const all = days.get(day) ?? rowsFor(day).map((row) => ({ key: order(row), row })).sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    days.set(day, all);
    const limit = Number(/LIMIT (\d+)$/.exec(query)?.[1]);
    const afterProduct = /WHERE product_slug > '((?:[^']|'')*)'/.exec(query)?.[1];
    const afterKey = /AND series_key = '((?:[^']|'')*)' AND hour > TIMESTAMP '([^']+)'\)/.exec(query);
    let start = 0;
    if (afterProduct !== undefined && afterKey) {
      const after = `${afterProduct}|${afterKey[1] ?? ""}|${afterKey[2] ?? ""}`.replace(/Z$/, "");
      const found = all.findIndex((each) => each.key.replace(/Z$/, "") > after);
      start = found < 0 ? all.length : found;
    }
    return Response.json({ success: true, result: { rows: all.slice(start, start + limit).map((each) => each.row), metrics: { bytes_scanned: 1_000 } } });
  };
  return { fetcher, queries };
}

function deps(rowsFor: (day: string) => JsonObject[] = powerRows) {
  const lake = fakeLake(rowsFor);
  const objects = new ObjectStore(new MemorySnapshots());
  return { lake, objects, deps: { env, objects, products, fetcher: lake.fetcher } };
}

describe("Lisbon days", () => {
  it("start at local midnight: UTC midnight in winter, 23:00 UTC the evening before in summer", () => {
    expect(lisbonDayBounds("2026-01-15")).toEqual({ from: "2026-01-15T00:00:00.000Z", to: "2026-01-16T00:00:00.000Z" });
    expect(lisbonDayBounds("2026-07-15")).toEqual({ from: "2026-07-14T23:00:00.000Z", to: "2026-07-15T23:00:00.000Z" });
    expect(lisbonDay(Date.parse("2026-07-14T23:30:00Z"))).toBe("2026-07-15");
  });

  it("last 23 hours when the clocks go forward and 25 when they go back", () => {
    expect(lisbonDayBounds("2026-03-29")).toEqual({ from: "2026-03-29T00:00:00.000Z", to: "2026-03-29T23:00:00.000Z" });
    expect(lisbonDayBounds("2026-10-25")).toEqual({ from: "2026-10-24T23:00:00.000Z", to: "2026-10-26T00:00:00.000Z" });
  });
});

describe("building summaries", () => {
  it("summarises each settled day once, every product in one query, into a month blob per product", async () => {
    const { lake, objects, deps: summaryDeps } = deps();
    const now = Date.parse("2026-09-12T12:00:00Z");
    const run = await summariseSettledDays(summaryDeps, now, 7);
    // 9 and 10 September are settled; the 11th ends at 23:00 UTC and waits a day for late points.
    expect(run.summarised).toEqual(["2026-09-09", "2026-09-10"]);
    expect(run.backlog).toBe(false);
    expect(run.nextDue).toBe(Date.parse("2026-09-12T23:15:00Z"));
    expect(lake.queries.filter((query) => query.includes("ROW_NUMBER"))).toHaveLength(2);
    expect(lake.queries[1]).toContain("__ingest_ts >= TIMESTAMP '2026-09-08T23:00:00.000Z' AND __ingest_ts < TIMESTAMP '2026-09-10T23:00:00.000Z'");

    const month = await readSummaryMonth(objects, "power-series", "2026-09");
    expect(month).toMatchObject({ version: 1, product: "power-series", month: "2026-09", timeZone: "Europe/Lisbon", resolution: "hour", days: ["2026-09-09", "2026-09-10"] });
    expect(month?.series).toEqual([{ key: "consumption", unit: "MW", dimensions: { source: "Consumption" } }]);
    expect(month?.buckets.slice(0, 2)).toEqual([["consumption", "2026-09-08T23:00:00.000Z", 4, 100, 90, 110], ["consumption", "2026-09-09T00:00:00.000Z", 4, 101, 91, 111]]);
    expect(month?.buckets).toHaveLength(6);
    expect(await readSummaryMonth(objects, "private-series", "2026-09")).toBeUndefined();

    const again = await summariseSettledDays(summaryDeps, now, 7);
    expect(again.summarised).toEqual([]);
    expect(lake.queries.filter((query) => query.includes("ROW_NUMBER"))).toHaveLength(2);
  });

  it("replaces a day summarised again instead of counting it twice", async () => {
    const { objects, deps: summaryDeps } = deps();
    const now = Date.parse("2026-09-12T12:00:00Z");
    await summariseDay(summaryDeps, "2026-09-09", now);
    await summariseDay(summaryDeps, "2026-09-09", now);
    expect((await readSummaryMonth(objects, "power-series", "2026-09"))?.buckets).toHaveLength(3);
  });

  it("keeps a product-month too large for hours by Lisbon day, reading the lake page by page", async () => {
    const { lake, objects, deps: summaryDeps } = deps(bigRows);
    await summariseDay(summaryDeps, "2026-09-09", Date.parse("2026-09-12T12:00:00Z"));
    expect(lake.queries).toHaveLength(4);
    const month = await readSummaryMonth(objects, "big-series", "2026-09");
    expect(month?.resolution).toBe("day");
    expect(month?.buckets).toHaveLength(2_600);
    // One bucket per series and Lisbon day, starting at Lisbon midnight: 24 hourly points, mean 11.5.
    expect(month?.buckets[0]).toEqual(["s0000", "2026-09-08T23:00:00.000Z", 24, 11.5, 0, 23]);
  });
});

describe("reading summaries", () => {
  async function summarised() {
    const setup = deps();
    await summariseSettledDays(setup.deps, Date.parse("2026-09-12T12:00:00Z"), 7);
    return setup.objects;
  }

  it("answers a range by the hour, the Lisbon day or the Lisbon month", async () => {
    const objects = await summarised();
    const range = { from: "2026-09-08T00:00:00Z", to: "2026-09-11T00:00:00Z", seriesKeys: [] };
    const hourly = await readSummaryRange(objects, "power-series", range);
    expect(hourly.resolution).toBe("hour");
    expect(hourly.coverage).toEqual({ firstDay: "2026-09-09", through: "2026-09-10" });
    expect(hourly.series.map((series) => [series.seriesKey, series.unit, series.buckets.length])).toEqual([["consumption", "MW", 6]]);

    const daily = await readSummaryRange(objects, "power-series", { ...range, resolution: "day" });
    expect(daily.series[0]?.buckets).toEqual([
      { start: "2026-09-08T23:00:00.000Z", count: 12, mean: 101, min: 90, max: 112 },
      { start: "2026-09-09T23:00:00.000Z", count: 12, mean: 101, min: 90, max: 112 },
    ]);
    const monthly = await readSummaryRange(objects, "power-series", { ...range, resolution: "month" });
    expect(monthly.series[0]?.buckets).toEqual([{ start: "2026-08-31T23:00:00.000Z", count: 24, mean: 101, min: 90, max: 112 }]);
  });

  it("reads nothing for years before the lake began, and filters by series", async () => {
    const objects = await summarised();
    const twentyYears = await readSummaryRange(objects, "power-series", { from: "2006-09-01T00:00:00Z", to: "2026-09-12T00:00:00Z", seriesKeys: [] });
    expect(twentyYears.resolution).toBe("month");
    expect(twentyYears.series[0]?.buckets).toHaveLength(1);
    const none = await readSummaryRange(objects, "power-series", { from: "2026-09-08T00:00:00Z", to: "2026-09-11T00:00:00Z", seriesKeys: ["other"] });
    expect(none.series).toEqual([]);
  });

  it("refuses ranges it would have to read too much for", async () => {
    const objects = new ObjectStore(new MemorySnapshots());
    await objects.write("summaries/v1/index.json", { version: 1, firstDay: "2020-01-01", through: "2026-09-10", updatedAt: "2026-09-12T00:00:00.000Z" });
    await expect(readSummaryRange(objects, "power-series", { from: "2020-01-01T00:00:00Z", to: "2026-09-01T00:00:00Z", seriesKeys: [] })).rejects.toThrow(/at most 36 months/);
    await expect(readSummaryRange(objects, "power-series", { from: "2026-09-01T00:00:00Z", to: "2026-08-01T00:00:00Z", seriesKeys: [] })).rejects.toThrow(/before to/);

    const crowded: SummaryBucket[] = Array.from({ length: MAX_SUMMARY_BUCKETS + 1 }, (_, index) => [`s${index}`, "2026-09-09T00:00:00.000Z", 1, 1, 1, 1]);
    const month: SummaryMonth = { version: 1, product: "crowded", month: "2026-09", timeZone: "Europe/Lisbon", resolution: "hour", days: ["2026-09-09"], series: [], buckets: crowded, updatedAt: "2026-09-12T00:00:00.000Z" };
    await objects.write(summaryKey("crowded", "2026-09"), month);
    await expect(readSummaryRange(objects, "crowded", { from: "2026-09-09T00:00:00Z", to: "2026-09-10T00:00:00Z", seriesKeys: [] })).rejects.toThrow(/name fewer series/);
  });

  it("closes a month once its last day is summarised", () => {
    expect(isClosedMonth("2026-09", Date.parse("2026-09-30T12:00:00Z"))).toBe(false);
    expect(isClosedMonth("2026-09", Date.parse("2026-10-02T00:00:00Z"))).toBe(true);
  });
});
