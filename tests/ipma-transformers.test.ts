import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TransformContext } from "@open-data-pt/gatekeeper-shared";
import { IpmaTransformer } from "../packages/gatekeeper-shared/src/sources/ipma/transform";

type FeedKind = "station-observations" | "daily-forecast" | "seismic";

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/ipma/${name}.json`, import.meta.url)));
}

function context(kind: FeedKind): TransformContext {
  return {
    feed: {
      id: `feed_${kind}`,
      slug: `ipma-${kind}-feed`,
      title: kind,
      description: "test feed",
      config: { feed: kind },
      semantics: {
        boundedness: "bounded",
        changeSemantics: kind === "seismic" ? "keyed-upsert" : "full-snapshot",
        cadence: "periodic",
        domainSubject: kind === "seismic" ? "event" : kind === "daily-forecast" ? "reference" : "observation",
        defaultProductRole: kind === "seismic" ? "event-log" : kind === "daily-forecast" ? "reference" : "time-series",
        completeness: "complete",
        ordering: kind === "daily-forecast" ? "none" : kind === "seismic" ? "global" : "per-entity",
      },
    },
    observedAt: "2026-09-07T17:35:04.000Z",
  };
}

describe("IPMA transformers", () => {
  const transformer = new IpmaTransformer();

  it("creates latest station records and one hourly series per measure", async () => {
    const result = await transformer.transform(fixture("station-observations"), context("station-observations"));

    expect(result.transformer).toEqual({ id: "ipma-open-data", version: "3" });
    expect(result.products.map((product) => [product.slug, product.role])).toEqual([
      ["ipma-stations-latest", "current-state"],
      ["ipma-observations", "time-series"],
    ]);
    expect(result.products[0]?.records).toHaveLength(2);
    expect(result.products[0]?.records?.[0]).toMatchObject({
      entityKey: "1210881",
      eventTime: "2026-09-07T16:00:00.000Z",
      payload: {
        stationName: "Olhão, EPPO",
        latitude: 37.033,
        longitude: -7.821,
        temperature: 31.4,
      },
    });
    expect(result.products[1]?.points).toHaveLength(30);
    expect(result.products[1]?.points).toContainEqual({
      seriesKey: "1210881:temperature",
      eventTime: "2026-09-07T16:00:00.000Z",
      value: 31.4,
      unit: "°C",
      dimensions: { station: "1210881", stationName: "Olhão, EPPO" },
    });
  });

  it("joins three forecast days to city, weather, and wind descriptions", async () => {
    const result = await transformer.transform(fixture("daily-forecast"), context("daily-forecast"));
    const product = result.products[0];

    expect(product).toMatchObject({
      slug: "ipma-forecast-daily",
      role: "reference",
      updateMode: "authoritative-snapshot",
    });
    expect(product?.records).toHaveLength(6);
    expect(product?.records?.[0]?.payload).toMatchObject({
      city: "Aveiro",
      weatherType: expect.any(String),
      weatherTypeId: expect.any(String),
      forecastDate: "2026-09-07",
      dataUpdate: "2026-09-07T16:31:03.000Z",
      minimumTemperature: 17,
      maximumTemperature: 25,
      precipitationProbability: 0,
    });
    expect(product?.schema.fields.find((field) => field.id === "weatherType")?.type).toBe("category");
    expect(product?.schema.fields.find((field) => field.id === "forecastDate")?.type).toBe("date");
    expect(product?.schema.fields.find((field) => field.id === "dataUpdate")?.type).toBe("datetime");
  });

  it("creates retained seismic changes with stable fallback identifiers", async () => {
    const first = await transformer.transform(fixture("seismic"), context("seismic"));
    const second = await transformer.transform(fixture("seismic"), context("seismic"));
    const product = first.products[0];
    const ids = product?.records?.map((record) => record.entityKey) ?? [];

    expect(product).toMatchObject({
      slug: "ipma-earthquakes",
      role: "event-log",
      updateMode: "source-window",
    });
    expect(ids).toContain("20260810020824C");
    expect(ids.some((id) => id.startsWith("ipma-") && id.length === 29)).toBe(true);
    expect(second.products[0]?.records?.map((record) => record.entityKey)).toEqual(ids);
    expect(product?.records?.find((record) => record.entityKey === "20260810020824C")).toMatchObject({
      operation: "upsert",
      eventTime: "2026-08-10T02:08:25.000Z",
      payload: {
        magnitude: 3.4,
        depth: 14,
        sensed: true,
        region: "E  Odemira",
      },
    });
  });

  it("rejects malformed compound documents", async () => {
    await expect(transformer.transform(new TextEncoder().encode("{}"), context("daily-forecast"))).rejects.toThrow(
      "requires forecasts, cities, weatherTypes, and windSpeedClasses",
    );
  });
});
