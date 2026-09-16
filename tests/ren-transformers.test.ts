import { jsonAs } from "./support";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runTransformer, type JsonObject, type JsonValue, type TransformContext } from "@open-data-pt/gatekeeper-shared";
import type { RenServiceName } from "../packages/gatekeeper-shared/src/sources/ren/ren";
import { RenTransformer } from "../packages/gatekeeper-shared/src/sources/ren/transform";

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/ren/${name}.json`, import.meta.url)));
}

function context(service: RenServiceName): TransformContext {
  return {
    feed: {
      id: `feed_${service}`,
      slug: `ren-${service}-feed`,
      title: service,
      description: "test feed",
      config: { service },
      semantics: {
        boundedness: "unbounded",
        changeSemantics: "full-snapshot",
        cadence: "near-real-time",
        domainSubject: "observation",
        defaultProductRole: "time-series",
        completeness: "unknown",
        ordering: "per-entity",
        eventTimeField: "eventTime",
        entityKeyField: "seriesKey",
      },
    },
    observedAt: "2026-09-07T12:00:00Z",
  };
}

function bytes(value: JsonValue | undefined): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function parsedFixture(name: string): JsonObject {
  return jsonAs<JsonObject>(readFileSync(new URL(`./fixtures/ren/${name}.json`, import.meta.url), "utf8"));
}

describe("REN transformers", () => {
  const transformer = new RenTransformer();

  it("creates typed time-series and daily reference products", () => {
    const result = transformer.transform(fixture("production-breakdown"), context("production-breakdown"));

    expect(result.products.map((product) => product.role)).toEqual(["time-series", "reference"]);
    const series = result.products[0];
    expect(series).toMatchObject({
      slug: "ren-production-breakdown-series",
      updateMode: "delta",
      watermark: "2026-09-05T23:45:00.000Z",
    });
    expect(series?.points?.[0]).toEqual({
      seriesKey: "consumption-storage",
      eventTime: "2026-09-05T23:00:00.000Z",
      value: 5526.9,
      unit: "MW",
      dimensions: {
        source: "Consumption + Storage",
        color: "#494949",
      },
    });
    expect(series?.schema.fields.map((field) => field.type)).toEqual(["identifier", "datetime", "number", "category", "json"]);

    const summary = result.products[1];
    expect(summary).toMatchObject({
      slug: "ren-production-breakdown-daily-summary",
      role: "reference",
      updateMode: "delta",
    });
    expect(summary?.schema.fields.find((field) => field.id === "source")).toMatchObject({
      type: "category",
      display: { badge: { colorField: "color" } },
    });
    expect(summary?.schema.fields.find((field) => field.id === "color")?.type).toBe("color");
    const consumption = summary?.records?.find((record) => record.entityKey === "2026-09-06:consumption");
    expect(consumption?.payload).toMatchObject({
      day: "2026-09-06",
      source: "Consumption",
      sampleCount: 4,
      totalEnergyMWh: 5420.3,
      minimum: 5327.5,
      maximum: 5526.4,
      shareOfConsumption: 100,
    });
  });

  it("summarises only finished Lisbon days, while the points of today still flow", () => {
    const sameDay = { ...context("production-breakdown"), observedAt: "2026-09-06T20:00:00Z" };
    const result = transformer.transform(fixture("production-breakdown"), sameDay);
    expect(result.products[0]?.points?.length).toBeGreaterThan(0);
    expect(result.products[1]?.records?.some((record) => record.entityKey.startsWith("2026-09-06:"))).toBe(false);
    // 23:30 UTC on the 6th is already the 7th in Lisbon (UTC+1): the 6th is finished.
    const nextDay = transformer.transform(fixture("production-breakdown"), { ...sameDay, observedAt: "2026-09-06T23:30:00Z" });
    expect(nextDay.products[1]?.records?.some((record) => record.entityKey.startsWith("2026-09-06:"))).toBe(true);
  });

  it("publishes only the consumption series for the consumption feed", () => {
    const value = parsedFixture("production-breakdown");
    value.service = "consumption";
    const result = transformer.transform(bytes(value), context("consumption"));
    expect(new Set(result.products[0]?.points?.map((point) => point.seriesKey))).toEqual(new Set(["consumption"]));
    expect(result.products[1]?.records).toHaveLength(1);
  });

  it("keeps a summary record for an all-null exchange series", () => {
    const result = transformer.transform(fixture("interconnection-exchanges"), context("interconnection-exchanges"));
    expect(result.products[0]?.points).toHaveLength(4);
    const exports = result.products[1]?.records?.find((record) => record.entityKey === "2026-09-06:exports");
    expect(exports?.payload).toMatchObject({
      source: "Exports",
      sampleCount: 0,
      totalEnergyMWh: null,
      minimum: null,
      maximum: null,
      shareOfConsumption: null,
    });
  });

  it("rolls post-midnight gas hours into the next civil day", () => {
    // SAFETY: the gas-consumption fixture is a REN chart document with the
    // service, days and chart axes this test walks.
    const value = parsedFixture("gas-consumption") as {
      service: string;
      days: Array<{
        day: string;
        response: {
          xAxis: { categories: string[] };
          series: Array<{ data: Array<number | null> }>;
        };
      }>;
    };
    value.days[0].response.xAxis.categories = ["23:00", "00:00"];
    for (const series of value.days[0].response.series) {
      series.data = series.data.slice(0, 2);
    }
    const result = transformer.transform(bytes(value), context("gas-consumption"));
    expect(result.products[0]?.points?.slice(0, 2).map((point) => point.eventTime)).toEqual(["2026-09-06T22:00:00.000Z", "2026-09-06T23:00:00.000Z"]);
  });

  it("distinguishes both occurrences of a repeated DST fallback hour", () => {
    const value = {
      service: "consumption",
      days: [
        {
          day: "2026-10-25",
          response: {
            xAxis: { categories: ["01:00", "01:00"] },
            yAxis: { title: { text: "MW" } },
            series: [
              {
                name: "Consumption",
                data: [10, 20],
                color: "#0D2965",
              },
            ],
          },
        },
      ],
    };
    const result = transformer.transform(bytes(value), context("consumption"));
    expect(result.products[0]?.points?.map((point) => point.eventTime)).toEqual(["2026-10-25T00:00:00.000Z", "2026-10-25T01:00:00.000Z"]);
  });

  it("is deterministic and stamps the transformer identity", async () => {
    const input = fixture("renewables-share");
    const first = await runTransformer(transformer, input, context("renewables-share"));
    const second = await runTransformer(transformer, input, context("renewables-share"));
    expect(second).toEqual(first);
    expect(first.transformer).toEqual({
      id: "ren-chart-services",
      version: "1",
    });
  });

  it("rejects malformed retained source documents", () => {
    expect(() => transformer.transform(bytes({ service: "consumption", days: [] }), context("consumption"))).toThrow("contains no days");
    expect(() =>
      transformer.transform(
        bytes({
          service: "consumption",
          days: [{ day: "2026-09-06", response: { message: "no data" } }],
        }),
        context("consumption"),
      ),
    ).toThrow("supported time-axis chart");
  });
});
