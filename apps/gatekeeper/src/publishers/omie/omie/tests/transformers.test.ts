import { readFixture } from "#/tests/support";
import { describe, expect, it } from "vitest";
import type { TransformContext } from "@open-data-pt/contract";
import { marketPeriodStart, OmieTransformer } from "#/publishers/omie/omie/transform";

type Series = "marginalpdbc" | "marginalpdbcpt";

function fixture(name: string): string {
  return readFixture(new URL(`./fixtures/${name}`, import.meta.url));
}

function context(series: Series, clocks: Partial<Pick<TransformContext, "observedAt">> = {}): TransformContext {
  return {
    feed: {
      slug: `omie-${series}-feed`,
      title: series,
      description: "test feed",
      config: { series, days: "2" },
      semantics: {
        domainSubject: "observation",
        defaultProductRole: "time-series",
      },
    },
    observedAt: clocks.observedAt ?? "2026-09-07T14:00:00.000Z",
  };
}

function captured(series: Series, files: Array<{ date: string; text: string }>): Uint8Array {
  return new TextEncoder().encode(
    JSON.stringify({
      series,
      files: files.map(({ date, text }) => ({
        date,
        filename: `${series}_${date.replaceAll("-", "")}.1`,
        text,
      })),
    }),
  );
}

function oneRowFile(series: Series, row: string): string {
  return `${series.toUpperCase()};\n${row}\n*\n`;
}

function periodFile(series: Series, date: string, periods: number): string {
  const [year, month, day] = date.split("-");
  const rows = Array.from({ length: periods }, (_, index) => `${year};${month};${day};${index + 1};10;20;`);
  return `${series.toUpperCase()};\n${rows.join("\n")}\n*\n`;
}

describe("OMIE transformers", () => {
  const transformer = new OmieTransformer();

  it("creates typed price points and daily summaries from a live trimmed fixture", () => {
    const result = transformer.transform(
      captured("marginalpdbc", [
        {
          date: "2026-09-06",
          text: fixture("marginalpdbc_20260906.1"),
        },
      ]),
      context("marginalpdbc"),
    );

    expect(result.transformer).toEqual({
      id: "omie-day-ahead-prices",
      version: "2",
    });
    expect(result.products.map((product) => [product.slug, product.role])).toEqual([
      ["omie-marginalpdbc-prices", "time-series"],
      ["omie-marginalpdbc-daily", "reference"],
    ]);
    const prices = result.products[0];
    expect(prices).toMatchObject({
      updateMode: "delta",
      watermark: "2026-09-06T21:45:00.000Z",
    });
    expect(prices?.points).toHaveLength(12);
    expect(prices?.points?.[0]).toEqual({
      seriesKey: "ES",
      eventTime: "2026-09-05T22:00:00.000Z",
      value: 214,
      unit: "EUR/MWh",
      dimensions: { country: "Spain", market: "day-ahead" },
    });
    expect(prices?.points?.[1]).toEqual({
      seriesKey: "PT",
      eventTime: "2026-09-05T22:00:00.000Z",
      value: 214,
      unit: "EUR/MWh",
      dimensions: { country: "Portugal", market: "day-ahead" },
    });
    expect(prices?.schema.fields.map((field) => [field.id, field.type])).toEqual([
      ["seriesKey", "identifier"],
      ["eventTime", "datetime"],
      ["value", "number"],
      ["unit", "category"],
      ["dimensions", "json"],
    ]);

    const daily = result.products[1];
    expect(daily).toMatchObject({
      updateMode: "authoritative-snapshot",
    });
    expect(daily?.records?.[0]).toMatchObject({
      entityKey: "2026-09-06",
      payload: {
        date: "2026-09-06",
        portugalMinimumPrice: 204.24,
        portugalMaximumPrice: 223.8,
        spainMinimumPrice: 204.24,
        spainMaximumPrice: 223.8,
      },
    });
    expect(Number(daily?.records?.[0]?.payload.portugalMeanPrice)).toBeCloseTo(215.2933, 4);
    expect(result.quality).toEqual({
      acceptedRecords: 13,
      rejectedRecords: 0,
    });
  });

  it("maps OMIE column five to Portugal and column six to Spain", () => {
    const result = transformer.transform(
      captured("marginalpdbcpt", [
        {
          date: "2026-09-06",
          text: oneRowFile("marginalpdbcpt", "2026;09;06;1;10.25;20.5;"),
        },
      ]),
      context("marginalpdbcpt"),
    );
    expect(result.products[0]?.points).toEqual([
      {
        seriesKey: "ES",
        eventTime: "2026-09-05T22:00:00.000Z",
        value: 20.5,
        unit: "EUR/MWh",
        dimensions: { country: "Spain", market: "day-ahead" },
      },
      {
        seriesKey: "PT",
        eventTime: "2026-09-05T22:00:00.000Z",
        value: 10.25,
        unit: "EUR/MWh",
        dimensions: { country: "Portugal", market: "day-ahead" },
      },
    ]);
  });

  it("converts the 92 spring-transition periods from Madrid market time to UTC", () => {
    expect(marketPeriodStart("2026-03-29", 1)).toBe("2026-03-28T23:00:00.000Z");
    expect(marketPeriodStart("2026-03-29", 92)).toBe("2026-03-29T21:45:00.000Z");
    expect(() => marketPeriodStart("2026-03-29", 93)).toThrow("expected 1-92");
  });

  it("converts the 100 autumn-transition periods from Madrid market time to UTC", () => {
    expect(marketPeriodStart("2026-10-25", 1)).toBe("2026-10-24T22:00:00.000Z");
    expect(marketPeriodStart("2026-10-25", 100)).toBe("2026-10-25T22:45:00.000Z");
    expect(() => marketPeriodStart("2026-10-25", 101)).toThrow("expected 1-100");
  });

  it("handles the documented 2025-10-01 switch from 24 hourly to 96 quarter-hourly periods", () => {
    const result = transformer.transform(
      captured("marginalpdbc", [
        {
          date: "2025-09-30",
          text: periodFile("marginalpdbc", "2025-09-30", 24),
        },
        {
          date: "2025-10-01",
          text: periodFile("marginalpdbc", "2025-10-01", 96),
        },
      ]),
      context("marginalpdbc"),
    );
    expect(result.products[0]?.points).toHaveLength((24 + 96) * 2);
    expect(result.products[1]?.records).toHaveLength(2);
    expect(result.products[1]?.records?.map((record) => record.eventTime)).toEqual(["2025-09-29T22:00:00.000Z", "2025-09-30T22:00:00.000Z"]);
  });

  it("is independent of acquisition clocks when replaying retained bytes", () => {
    const bytes = captured("marginalpdbc", [
      {
        date: "2026-09-06",
        text: fixture("marginalpdbc_20260906.1"),
      },
    ]);
    const first = transformer.transform(bytes, context("marginalpdbc"));
    const replay = transformer.transform(bytes, context("marginalpdbc", { observedAt: "2030-01-01T00:00:00.000Z" }));
    expect(replay).toEqual(first);
  });

  it("rejects malformed compound documents and mismatched configurations", () => {
    expect(() => transformer.transform(new TextEncoder().encode("{}"), context("marginalpdbc"))).toThrow("requires a supported series and files");

    const bytes = captured("marginalpdbc", [
      {
        date: "2026-09-06",
        text: fixture("marginalpdbc_20260906.1"),
      },
    ]);
    const mismatched = context("marginalpdbcpt");
    expect(() => transformer.transform(bytes, mismatched)).toThrow("does not match configured series");
  });
});
