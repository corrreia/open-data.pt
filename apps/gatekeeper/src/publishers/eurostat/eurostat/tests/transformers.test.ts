import { readFixtureBytes } from "#/tests/support";
import { describe, expect, it } from "vitest";
import type { JsonValue, TransformContext } from "@open-data-pt/contract";
import { normalizeEurostatPeriod, transformEurostatDataset } from "#/publishers/eurostat/eurostat/transform";

function fixture(name: string): Uint8Array {
  return readFixtureBytes(new URL(`./fixtures/${name}`, import.meta.url));
}

function context(slug: string, title: string): TransformContext {
  return {
    feed: {
      slug,
      title,
      description: "test feed",
      config: {
        dataset: "une_rt_m",
        filters: "geo=PT",
        lastTimePeriod: "120",
        lang: "EN",
      },
      semantics: {
        domainSubject: "observation",
        defaultProductRole: "reference",
      },
    },
    observedAt: "2026-09-07T21:00:51Z",
  };
}

function bytes(value: JsonValue | undefined): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("Eurostat JSON-stat transformer", () => {
  it("decodes a live sparse monthly dataset without inventing missing rows", () => {
    const result = transformEurostatDataset(fixture("unemployment-monthly.json"), context("eurostat-unemployment", "Portugal monthly unemployment rate"));

    expect(result.transformer).toEqual({
      id: "eurostat-jsonstat-dataset",
      version: "3",
    });
    expect(result.quality).toEqual({
      acceptedRecords: 2,
      rejectedRecords: 0,
    });
    // Every value is published once: no record product repeats the points.
    expect(result.products.map(({ role, kind }) => [role, kind])).toEqual([["time-series", "series"]]);

    const series = result.products[0];
    expect(series?.points).toHaveLength(2);
    expect(series?.schema.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "value",
          type: "number",
          unit: "Percentage of population in the labour force",
        }),
      ]),
    );
    expect(series).toMatchObject({
      slug: "eurostat-unemployment-series",
      updateMode: "authoritative-snapshot",
      watermark: "2026-07-01T00:00:00Z",
    });
    expect(series?.points?.[0]).toEqual({
      seriesKey: "all",
      eventTime: "2026-06-01T00:00:00Z",
      value: 5.7,
      unit: "Percentage of population in the labour force",
      dimensions: {},
    });
    expect(series?.description).toContain("Geopolitical entity (reporting): Portugal");
  });

  it("decodes live quarterly values and sparse status flags", () => {
    const result = transformEurostatDataset(fixture("gdp-quarterly.json"), context("eurostat-gdp", "Portugal quarterly GDP"));

    expect(result.quality).toMatchObject({
      acceptedRecords: 8,
      rejectedRecords: 0,
    });
    expect(result.products[0]?.points?.[0]).toMatchObject({
      eventTime: "2024-07-01T00:00:00Z",
      value: 52_279.9,
    });
    expect(result.products[0]?.points?.at(-1)).toMatchObject({
      eventTime: "2026-04-01T00:00:00Z",
      value: 54_437.6,
      unit: "Chain linked volumes (2010), million euro",
    });
    expect(result.products[0]?.watermark).toBe("2026-04-01T00:00:00Z");
  });

  it("materializes varying dimensions as typed labels and codes", () => {
    const dataset = {
      version: "2.0",
      class: "dataset",
      label: "Example",
      id: ["unit", "geo", "time"],
      size: [1, 2, 1],
      role: { metric: ["unit"], geo: ["geo"], time: ["time"] },
      dimension: {
        unit: {
          label: "Unit of measure",
          category: { index: { PC: 0 }, label: { PC: "Percent" } },
        },
        geo: {
          label: "Geopolitical entity",
          category: {
            index: { PT: 0, ES: 1 },
            label: { PT: "Portugal", ES: "Spain" },
          },
        },
        time: {
          label: "Time",
          category: { index: { "2026-W10": 0 } },
        },
      },
      value: { "0": 1.2, "1": 2.3 },
      status: { "1": "p" },
    };
    const result = transformEurostatDataset(bytes(dataset), context("eurostat-example", "Example"));
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.points).toEqual([
      expect.objectContaining({
        seriesKey: "ES",
        dimensions: { "Geopolitical entity": "Spain" },
      }),
      expect.objectContaining({
        seriesKey: "PT",
        dimensions: { "Geopolitical entity": "Portugal" },
      }),
    ]);
  });

  it("normalizes Eurostat annual, quarterly, monthly, weekly, and daily periods to starts", () => {
    expect(normalizeEurostatPeriod("2026")).toBe("2026-01-01");
    expect(normalizeEurostatPeriod("2026-Q1")).toBe("2026-01-01");
    expect(normalizeEurostatPeriod("2026-03")).toBe("2026-03-01");
    expect(normalizeEurostatPeriod("2026-W10")).toBe("2026-03-02");
    expect(normalizeEurostatPeriod("2026-03-01")).toBe("2026-03-01");
    expect(normalizeEurostatPeriod("2026-W54")).toBeUndefined();
    expect(normalizeEurostatPeriod("2026-02-31")).toBeUndefined();
  });

  it("is pure and types every schema field", () => {
    const input = fixture("gdp-quarterly.json");
    const transformContext = context("eurostat-gdp", "Portugal quarterly GDP");
    const first = transformEurostatDataset(input, transformContext);
    const second = transformEurostatDataset(input, transformContext);
    expect(second).toEqual(first);
    for (const product of first.products) {
      for (const field of product.schema.fields) {
        expect(["identifier", "category", "latitude", "longitude", "number", "date", "datetime", "string", "url", "boolean", "color", "geometry", "json"]).toContain(field.type);
      }
    }
  });

  it("rejects malformed JSON-stat input", () => {
    expect(() => transformEurostatDataset(bytes({ class: "dataset" }), context("eurostat-broken", "Broken"))).toThrow("JSON-stat 2.0");
  });
});
