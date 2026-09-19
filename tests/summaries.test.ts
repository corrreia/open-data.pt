import type { JsonObject } from "@open-data-pt/gatekeeper-shared";
import { describe, expect, it } from "vitest";
import { ObjectStore } from "../apps/kernel/src/object-store";
import {
  MAX_SUMMARY_BUCKETS,
  PUBLISHED_AHEAD_MS,
  isClosedMonth,
  lisbonDay,
  lisbonDayBounds,
  readSummaryFile,
  readSummaryRange,
  summariseDay,
  summariseSettledDays,
  summaryKey,
  type SummaryBucket,
  type SummaryDeps,
  type SummaryIndex,
  type SummaryMonth,
} from "../apps/kernel/src/summaries";
import { MemorySnapshots } from "./kernel-harness";

const env = { CATALOG_TOKEN: "token", LAKE_BUCKET: "history", CLOUDFLARE_ACCOUNT_ID: "account" };
const products = new Set(["power-series", "big-series", "gas-series"]);
const NOW = Date.parse("2026-09-12T12:00:00Z");

/** R2 SQL writes microseconds. */
const lakeHour = (instant: number) => new Date(instant).toISOString().replace(".000Z", ".000000Z");
/** A Lisbon-day bucket as the late pass's SQL returns it: the wall-clock date at midnight. */
const lakeDay = (day: string) => `${day}T00:00:00.000000Z`;

type QueryKind = "fresh" | "late-day" | "late-hour";
type Rows = (kind: QueryKind, day: string) => JsonObject[];

/** Three hours of one power series for a Lisbon day, and one row of a product the summaries leave out. */
function powerRows(day: string): JsonObject[] {
  const start = Date.parse(lisbonDayBounds(day).from);
  return [
    ...[0, 1, 2].map((hour) => ({
      product_slug: "power-series",
      series_key: "consumption",
      hour: lakeHour(start + hour * 3_600_000),
      n: 4,
      mean: 100 + hour,
      low: 90 + hour,
      high: 110 + hour,
      unit: "MW",
      dimensions: '{"source":"Consumption"}',
    })),
    { product_slug: "private-series", series_key: "x", hour: lakeHour(start), n: 1, mean: 1, low: 1, high: 1, unit: "", dimensions: "{}" },
  ];
}

/** 2,600 series with a point every hour: more than a month of hours may hold. */
function bigRows(day: string): JsonObject[] {
  const start = Date.parse(lisbonDayBounds(day).from);
  const rows: JsonObject[] = [];
  for (let series = 0; series < 2_600; series += 1) {
    for (let hour = 0; hour < 24; hour += 1)
      rows.push({
        product_slug: "big-series",
        series_key: `s${String(series).padStart(4, "0")}`,
        hour: lakeHour(start + hour * 3_600_000),
        n: 1,
        mean: hour,
        low: hour,
        high: hour,
        unit: "°C",
        dimensions: "{}",
      });
  }
  return rows;
}

const freshOnly: Rows = (kind, day) => (kind === "fresh" ? powerRows(day) : []);

/** A row's place in R2 SQL's order: product, series, then its bucket time (milliseconds, as the keyset carries it). */
const order = (row: JsonObject, column: string) => `${String(row.product_slug)}|${String(row.series_key)}|${String(row[column]).replace(/(\.\d{3})\d+/, "$1")}`;

/**
 * A lake that answers the first-ingest probe and every summary query, paging by
 * product, series and bucket as R2 SQL would. Fresh queries are keyed by their
 * event day, late ones by their ingest day.
 */
function fakeLake(rowsFor: Rows) {
  const queries: string[] = [];
  const sorted = new Map<string, Array<{ key: string; row: JsonObject }>>();
  const fetcher: typeof fetch = async (_input, init) => {
    // SAFETY: runLakeQuery always posts `{ query }` as its JSON body.
    const { query } = JSON.parse(String(init?.body)) as { query: string };
    queries.push(query);
    if (query.includes("MIN(__ingest_ts)"))
      return Response.json({ success: true, result: { rows: [{ first_ingest: "2026-09-09T10:00:00.000000Z" }], metrics: { bytes_scanned: 10 } } });
    const kind: QueryKind = query.includes("ROW_NUMBER") ? "fresh" : query.includes("local_time") ? "late-day" : "late-hour";
    const column = kind === "late-day" ? "day" : "hour";
    const bound = kind === "fresh" ? /event_time >= TIMESTAMP '([^']+)'/.exec(query)?.[1] : /__ingest_ts >= TIMESTAMP '([^']+)'/.exec(query)?.[1];
    const id = `${kind}|${lisbonDay(Date.parse(bound ?? ""))}`;
    const all =
      sorted.get(id) ??
      rowsFor(kind, lisbonDay(Date.parse(bound ?? "")))
        .map((row) => ({ key: order(row, column), row }))
        .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    sorted.set(id, all);
    const cursor = /AND product_slug > '((?:[^']|'')*)'/.exec(query)?.[1];
    const afterProduct = /WHERE product_slug > '((?:[^']|'')*)' OR/.exec(query)?.[1];
    const afterKey = new RegExp(`AND series_key = '((?:[^']|'')*)' AND ${column} > TIMESTAMP '([^']+)'\\)`).exec(query);
    let rows = cursor === undefined ? all : all.filter((each) => String(each.row.product_slug) > cursor);
    if (afterProduct !== undefined && afterKey) {
      const after = `${afterProduct}|${afterKey[1] ?? ""}|${(afterKey[2] ?? "").replace(/(\.\d{3})\d+/, "$1")}`;
      rows = rows.filter((each) => each.key > after);
    }
    const limit = Number(/LIMIT (\d+)$/.exec(query)?.[1]);
    return Response.json({ success: true, result: { rows: rows.slice(0, limit).map((each) => each.row), metrics: { bytes_scanned: 1_000 } } });
  };
  return { fetcher, queries };
}

function setup(rowsFor: Rows = freshOnly, lateBudget?: number) {
  const lake = fakeLake(rowsFor);
  const objects = new ObjectStore(new MemorySnapshots());
  const deps: SummaryDeps = { env, objects, products, fetcher: lake.fetcher };
  if (lateBudget !== undefined) deps.lateBudget = lateBudget;
  return { lake, objects, deps };
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

describe("the fresh pass", () => {
  it("summarises each settled day once, every product in one query, into month and year blobs", async () => {
    const { lake, objects, deps } = setup();
    const run = await summariseSettledDays(deps, NOW, 7, 0);
    // 9 and 10 September are settled; the 11th ends at 23:00 UTC and waits a day for late points.
    expect(run.summarised).toEqual(["2026-09-09", "2026-09-10"]);
    const fresh = lake.queries.filter((query) => query.includes("ROW_NUMBER"));
    expect(fresh).toHaveLength(2);
    // A day's points are read from the ingest days it may have been published in: ten days before it begins, until a day after it ends.
    expect(fresh[0]).toContain("__ingest_ts >= TIMESTAMP '2026-08-29T23:00:00.000Z' AND __ingest_ts < TIMESTAMP '2026-09-10T23:00:00.000Z'");
    expect(fresh[0]).toContain("event_time >= TIMESTAMP '2026-09-08T23:00:00.000Z' AND event_time < TIMESTAMP '2026-09-09T23:00:00.000Z'");
    // A point is one point per product, series and time, whichever feed ID wrote it.
    expect(fresh[0]).toContain("PARTITION BY product_slug, series_key, event_time ORDER BY");

    const month = await readSummaryFile(objects, "power-series", "2026-09");
    expect(month).toMatchObject({ version: 1, product: "power-series", month: "2026-09", timeZone: "Europe/Lisbon", resolution: "hour", days: ["2026-09-09", "2026-09-10"] });
    expect(month?.series).toEqual([{ key: "consumption", unit: "MW", dimensions: { source: "Consumption" } }]);
    expect(month?.buckets.slice(0, 2)).toEqual([
      ["consumption", "2026-09-08T23:00:00.000Z", 4, 100, 90, 110],
      ["consumption", "2026-09-09T00:00:00.000Z", 4, 101, 91, 111],
    ]);
    expect(month?.buckets).toHaveLength(6);
    expect(await readSummaryFile(objects, "private-series", "2026-09")).toBeUndefined();
    expect(await readSummaryFile(objects, "power-series", "2026")).toMatchObject({
      year: "2026",
      resolution: "month",
      buckets: [["consumption", "2026-08-31T23:00:00.000Z", 24, 101, 90, 112]],
    });

    const again = await summariseSettledDays(deps, NOW, 7, 0);
    expect(again.summarised).toEqual([]);
    expect(lake.queries.filter((query) => query.includes("ROW_NUMBER"))).toHaveLength(2);
  });

  it("replaces a day summarised again instead of counting it twice", async () => {
    const { objects, deps } = setup();
    await summariseDay(deps, "2026-09-09", NOW);
    await summariseDay(deps, "2026-09-09", NOW);
    expect((await readSummaryFile(objects, "power-series", "2026-09"))?.buckets).toHaveLength(3);
  });

  it("counts a day's points however far ahead they were published, and only that day's", async () => {
    const { lake, deps } = setup();
    await summariseDay(deps, "2026-09-09", NOW);
    const fresh = lake.queries.find((query) => query.includes("ROW_NUMBER")) ?? "";
    const ingestFrom = /__ingest_ts >= TIMESTAMP '([^']+)'/.exec(fresh)?.[1] ?? "";
    const eventFrom = /event_time >= TIMESTAMP '([^']+)'/.exec(fresh)?.[1] ?? "";
    // Day-ahead prices and load forecasts arrive before the hours they are about, so the ingest window opens well before the event window.
    expect(Date.parse(eventFrom) - Date.parse(ingestFrom)).toBe(PUBLISHED_AHEAD_MS);
    expect(fresh).toContain("event_time < TIMESTAMP '2026-09-09T23:00:00.000Z'");
  });

  it("keeps a product-month too large for hours by Lisbon day, reading the lake page by page", async () => {
    const { lake, objects, deps } = setup((kind, day) => (kind === "fresh" ? bigRows(day) : []));
    await summariseDay(deps, "2026-09-09", NOW);
    expect(lake.queries).toHaveLength(4);
    const month = await readSummaryFile(objects, "big-series", "2026-09");
    expect(month?.resolution).toBe("day");
    expect(month?.buckets).toHaveLength(2_600);
    // One bucket per series and Lisbon day, starting at Lisbon midnight: 24 hourly points, mean 11.5.
    expect(month?.buckets[0]).toEqual(["s0000", "2026-09-08T23:00:00.000Z", 24, 11.5, 0, 23]);
  });
});

describe("the late pass", () => {
  /** A backfill landing on 9 September (two days of 2018, and an hour of 3 September) and walked again on the 10th. */
  const backfill: Rows = (kind, day) => {
    const history = (rows: Array<[string, number, number]>) =>
      rows.map(([date, n, mean]) => ({
        product_slug: "power-series",
        series_key: "consumption",
        day: lakeDay(date),
        n,
        mean,
        low: mean - 100,
        high: mean + 100,
        unit: "MW",
        dimensions: '{"source":"Consumption"}',
      }));
    if (kind === "fresh") return powerRows(day);
    if (kind === "late-day" && day === "2026-09-09")
      return history([
        ["2018-01-15", 96, 5000],
        ["2018-07-15", 96, 5000],
      ]);
    // The second walk brings a complete 15 January and a partial 15 July: the complete day replaces, the partial one does not.
    if (kind === "late-day" && day === "2026-09-10")
      return history([
        ["2018-01-15", 96, 5100],
        ["2018-07-15", 50, 1],
      ]);
    if (kind === "late-hour" && day === "2026-09-09")
      return [
        {
          product_slug: "power-series",
          series_key: "consumption",
          hour: "2026-09-03T10:00:00.000000Z",
          n: 4,
          mean: 200,
          low: 190,
          high: 210,
          unit: "MW",
          dimensions: '{"source":"Consumption"}',
        },
      ];
    return [];
  };

  it("summarises backfilled history by Lisbon day, walked twice but counted once, into month and year blobs", async () => {
    const { lake, objects, deps } = setup(backfill);
    // The fresh pass has the first wake to itself; the late pass follows in the next.
    const fresh = await summariseSettledDays(deps, NOW, 7, 7);
    expect([fresh.summarised, fresh.late, fresh.backlog]).toEqual([["2026-09-09", "2026-09-10"], [], true]);
    const run = await summariseSettledDays(deps, NOW, 7, 7);
    expect(run.late).toEqual(["2026-09-09", "2026-09-10"]);
    expect(run.backlog).toBe(false);
    expect(run.nextDue).toBe(Date.parse("2026-09-12T23:15:00Z"));

    const daily = lake.queries.find((query) => query.includes("local_time") && query.includes("__ingest_ts >= TIMESTAMP '2026-09-08T23:00:00.000Z'"));
    // Before the lake's first month by Lisbon day, knowing when the clocks changed back to 1996.
    expect(daily).toContain("event_time < TIMESTAMP '2026-08-31T23:00:00.000Z'");
    expect(daily).toContain("WHEN event_time >= TIMESTAMP '1996-03-31T01:00:00Z' AND event_time < TIMESTAMP '1996-10-27T01:00:00Z' THEN event_time + INTERVAL '1 hour'");
    expect(daily).toContain("WHEN event_time >= TIMESTAMP '2018-03-25T01:00:00Z' AND event_time < TIMESTAMP '2018-10-28T01:00:00Z' THEN event_time + INTERVAL '1 hour'");
    const hourly = lake.queries.find((query) => query.includes("COUNT(DISTINCT event_time)") && !query.includes("local_time"));
    // The lake's first day has no fresh pass for the day before it, so its ingest covers everything before it.
    expect(hourly).toContain("event_time >= TIMESTAMP '2026-08-31T23:00:00.000Z' AND event_time < TIMESTAMP '2026-09-08T23:00:00.000Z'");

    expect(await readSummaryFile(objects, "power-series", "2018-01")).toMatchObject({
      resolution: "day",
      days: ["2018-01-15"],
      buckets: [["consumption", "2018-01-15T00:00:00.000Z", 96, 5100, 5000, 5200]],
    });
    // Backfilled history keeps its series' dimensions, as the fresh pass does, never an empty `{}` over a filled one:
    // MAX alone compares the JSON as text, where `{}` sorts last.
    const anyFilled = "MAX(CASE WHEN dimensions IS NOT NULL AND dimensions != '' AND dimensions != '{}' THEN dimensions END) AS dimensions";
    expect(daily).toContain(anyFilled);
    expect(hourly).toContain(anyFilled);
    expect(lake.queries.find((query) => query.includes("ROW_NUMBER"))).toContain(anyFilled);
    expect((await readSummaryFile(objects, "power-series", "2018-01"))?.series).toEqual([{ key: "consumption", unit: "MW", dimensions: { source: "Consumption" } }]);
    expect((await readSummaryFile(objects, "power-series", "2018-07"))?.buckets).toEqual([["consumption", "2018-07-14T23:00:00.000Z", 96, 5000, 4900, 5100]]);
    const september = await readSummaryFile(objects, "power-series", "2026-09");
    expect(september?.resolution).toBe("hour");
    expect(september?.buckets).toContainEqual(["consumption", "2026-09-03T10:00:00.000Z", 4, 200, 190, 210]);
    expect(await readSummaryFile(objects, "power-series", "2018")).toMatchObject({
      resolution: "month",
      buckets: [
        ["consumption", "2018-01-01T00:00:00.000Z", 96, 5100, 5000, 5200],
        ["consumption", "2018-06-30T23:00:00.000Z", 96, 5000, 4900, 5100],
      ],
    });
    expect(await objects.read<SummaryIndex>("summaries/v1/index.json")).toMatchObject({
      firstDay: "2026-09-09",
      through: "2026-09-10",
      earliestDay: "2018-01-15",
      lateThrough: "2026-09-10",
    });
  });

  it("spreads a heavy backfill day over several wakes, whole products at a time", async () => {
    const rowsFor: Rows = (kind, day) => {
      if (kind === "fresh") return powerRows(day);
      if (kind !== "late-day" || day !== "2026-09-09") return [];
      return ["gas-series", "power-series"].flatMap((product) =>
        ["2018-01-15", "2018-02-15", "2018-03-15"].map((date) => ({ product_slug: product, series_key: "x", day: lakeDay(date), n: 1, mean: 1, low: 1, high: 1, unit: "" })),
      );
    };
    // Each product costs three month merges (six calls) and one year rebuild (thirteen): a budget of 20 takes one product per wake.
    const { lake, objects, deps } = setup(rowsFor, 20);
    await summariseSettledDays(deps, NOW, 7, 7);
    const first = await summariseSettledDays(deps, NOW, 7, 7);
    expect(first.late).toEqual([]);
    expect(first.backlog).toBe(true);
    expect(await readSummaryFile(objects, "gas-series", "2018-02")).toBeDefined();
    expect(await readSummaryFile(objects, "power-series", "2018-02")).toBeUndefined();
    expect(await objects.read<SummaryIndex>("summaries/v1/index.json")).toMatchObject({ lateCursor: "day|gas-series" });

    const second = await summariseSettledDays(deps, NOW, 7, 1);
    expect(second.late).toEqual(["2026-09-09"]);
    expect(lake.queries.some((query) => query.includes("AND product_slug > 'gas-series'"))).toBe(true);
    expect(await readSummaryFile(objects, "power-series", "2018-02")).toBeDefined();
  });
});

describe("reading summaries", () => {
  async function summarised(rowsFor: Rows = freshOnly) {
    const { objects, deps } = setup(rowsFor);
    // Wake after wake, until nothing is left to do.
    for (let wake = 0; wake < 5; wake += 1) if (!(await summariseSettledDays(deps, NOW, 7, 7)).backlog) break;
    return objects;
  }

  it("answers a range by the hour, the Lisbon day or the Lisbon month, and says where summaries end", async () => {
    const objects = await summarised();
    const range = { from: "2026-09-08T00:00:00Z", to: "2026-09-11T00:00:00Z", seriesKeys: [] };
    const hourly = await readSummaryRange(objects, "power-series", range);
    expect(hourly.resolution).toBe("hour");
    expect(hourly.coverage).toEqual({ firstDay: "2026-09-09", through: "2026-09-10", until: "2026-09-10T23:00:00.000Z" });
    expect(hourly.series.map((series) => [series.seriesKey, series.unit, series.buckets.length])).toEqual([["consumption", "MW", 6]]);

    const daily = await readSummaryRange(objects, "power-series", { ...range, resolution: "day" });
    expect(daily.series[0]?.buckets).toEqual([
      { start: "2026-09-08T23:00:00.000Z", count: 12, mean: 101, min: 90, max: 112 },
      { start: "2026-09-09T23:00:00.000Z", count: 12, mean: 101, min: 90, max: 112 },
    ]);
    const monthly = await readSummaryRange(objects, "power-series", { ...range, from: "2026-08-01T00:00:00Z", resolution: "month" });
    expect(monthly.series[0]?.buckets).toEqual([{ start: "2026-08-31T23:00:00.000Z", count: 24, mean: 101, min: 90, max: 112 }]);
  });

  it("leaves out a day the window opens in the middle of, rather than naming a part of it after the whole", async () => {
    const objects = await summarised();
    // Half past midnight UTC is the middle of Lisbon 9 September, which runs from 23:00 on the 8th.
    const midday = { from: "2026-09-09T00:30:00Z", to: "2026-09-11T00:00:00Z", seriesKeys: [] };
    const daily = await readSummaryRange(objects, "power-series", { ...midday, resolution: "day" });
    expect(daily.series[0]?.buckets).toEqual([{ start: "2026-09-09T23:00:00.000Z", count: 12, mean: 101, min: 90, max: 112 }]);
    // By the hour every bucket is whole already, so the window keeps the hours that start in it.
    const hourly = await readSummaryRange(objects, "power-series", { ...midday, resolution: "hour" });
    expect(hourly.series[0]?.buckets.map((bucket) => bucket.start)).toEqual([
      "2026-09-09T01:00:00.000Z",
      "2026-09-09T23:00:00.000Z",
      "2026-09-10T00:00:00.000Z",
      "2026-09-10T01:00:00.000Z",
    ]);
  });

  it("reaches back into backfilled history by month, reading only the years that hold it", async () => {
    const objects = await summarised((kind, day) =>
      kind === "fresh"
        ? powerRows(day)
        : kind === "late-day" && day === "2026-09-09"
          ? [{ product_slug: "power-series", series_key: "consumption", day: lakeDay("2016-10-02"), n: 96, mean: 4000, low: 3000, high: 5000, unit: "MW" }]
          : [],
    );
    const forty = await readSummaryRange(objects, "power-series", { from: "1986-09-01T00:00:00Z", to: "2026-09-12T00:00:00Z", seriesKeys: [] });
    expect(forty.resolution).toBe("month");
    expect(forty.coverage.firstDay).toBe("2016-10-02");
    expect(forty.series[0]?.buckets.map((bucket) => bucket.start)).toEqual(["2016-09-30T23:00:00.000Z", "2026-08-31T23:00:00.000Z"]);
    const none = await readSummaryRange(objects, "power-series", { from: "2026-09-08T00:00:00Z", to: "2026-09-11T00:00:00Z", seriesKeys: ["other"] });
    expect(none.series).toEqual([]);
  });

  it("answers decades of a short history as its own span would be, unless asked for months", async () => {
    const objects = await summarised();
    const decades = { from: "1986-09-01T00:00:00Z", to: "2026-09-12T00:00:00Z", seriesKeys: [] };
    const fitted = await readSummaryRange(objects, "power-series", decades);
    expect(fitted.resolution).toBe("hour");
    expect(fitted.series[0]?.buckets).toHaveLength(6);
    const asked = await readSummaryRange(objects, "power-series", { ...decades, resolution: "month" });
    expect(asked.series[0]?.buckets).toHaveLength(1);
  });

  it("refuses ranges it would have to read too much for", async () => {
    const objects = new ObjectStore(new MemorySnapshots());
    const index: SummaryIndex = { version: 1, firstDay: "2020-01-01", through: "2026-09-10", updatedAt: "2026-09-12T00:00:00.000Z" };
    await objects.write("summaries/v1/index.json", index);
    await expect(readSummaryRange(objects, "power-series", { from: "2020-01-01T00:00:00Z", to: "2026-09-01T00:00:00Z", resolution: "day", seriesKeys: [] })).rejects.toThrow(
      /at most 36 months/,
    );
    await expect(readSummaryRange(objects, "power-series", { from: "2026-09-01T00:00:00Z", to: "2026-08-01T00:00:00Z", seriesKeys: [] })).rejects.toThrow(/before to/);

    const crowded: SummaryBucket[] = Array.from({ length: MAX_SUMMARY_BUCKETS + 1 }, (_, index) => [`s${index}`, "2026-09-09T00:00:00.000Z", 1, 1, 1, 1]);
    const month: SummaryMonth = {
      version: 1,
      product: "crowded",
      month: "2026-09",
      timeZone: "Europe/Lisbon",
      resolution: "hour",
      days: ["2026-09-09"],
      series: [],
      buckets: crowded,
      updatedAt: "2026-09-12T00:00:00.000Z",
    };
    await objects.write(summaryKey("crowded", "2026-09"), month);
    await expect(readSummaryRange(objects, "crowded", { from: "2026-09-09T00:00:00Z", to: "2026-09-10T00:00:00Z", seriesKeys: [] })).rejects.toThrow(/name fewer series/);
  });

  it("closes a month once its last day is summarised", () => {
    expect(isClosedMonth("2026-09", Date.parse("2026-09-30T12:00:00Z"))).toBe(false);
    expect(isClosedMonth("2026-09", Date.parse("2026-10-02T00:00:00Z"))).toBe(true);
  });
});
