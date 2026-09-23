import { jsonAs, readFixtureBytes } from "#/tests/support";
import { describe, expect, it } from "vitest";
import type { JsonValue, TransformContext } from "@open-data-pt/contract";
import { DgegTransformer } from "#/publishers/dgeg/dgeg/transform";

function fixture(name: string): Uint8Array {
  return readFixtureBytes(new URL(`./fixtures/${name}`, import.meta.url));
}

function context(feed: "fuel-prices" | "fuel-types"): TransformContext {
  return {
    feed: {
      slug: `dgeg-${feed}`,
      title: feed,
      description: "test feed",
      config: feed === "fuel-prices" ? { feed, fuelTypeId: "3201", districtId: "11" } : { feed },
      semantics: {
        domainSubject: feed === "fuel-prices" ? "observation" : "reference",
        defaultProductRole: feed === "fuel-prices" ? "current-state" : "reference",
      },
    },
    observedAt: "2026-09-07T17:46:41Z",
  };
}

describe("DGEG transformers", () => {
  const transformer = new DgegTransformer();

  it("creates a typed fuel reference product and stamps the transformer", () => {
    const transformed = transformer.transform(fixture("fuel-types.json"), context("fuel-types"));

    expect(transformed.transformer).toEqual({ id: "dgeg-fuel-prices", version: "1" });
    expect(transformed.products[0]).toMatchObject({
      slug: "dgeg-fuel-types",
      role: "reference",
      updateMode: "authoritative-snapshot",
    });
    expect(transformed.products[0]?.schema.fields).toContainEqual(
      expect.objectContaining({
        id: "name",
        type: "string",
        display: { badge: { colorField: "color" } },
      }),
    );
    expect(transformed.products[0]?.schema.fields).toContainEqual(
      expect.objectContaining({
        id: "color",
        type: "color",
        nullable: true,
      }),
    );
    expect(transformed.products[0]?.records?.[0]).toMatchObject({
      entityKey: expect.any(String),
      payload: {
        id: expect.any(String),
        name: expect.any(String),
        unit: expect.any(String),
        roadFuel: expect.any(Boolean),
        active: expect.any(Boolean),
      },
    });
    expect(transformed.quality).toEqual({
      acceptedRecords: 4,
      rejectedRecords: 0,
    });
  });

  it("maps station prices and coordinates into current state with stable entity keys", () => {
    const transformed = transformer.transform(fixture("fuel-prices-lisbon.json"), context("fuel-prices"));
    const stations = transformed.products[0];

    expect(stations).toMatchObject({
      slug: "stations-3201-district-11",
      role: "current-state",
      updateMode: "authoritative-snapshot",
    });
    expect(stations?.schema.fields).toContainEqual(
      expect.objectContaining({
        id: "latitude",
        type: "latitude",
      }),
    );
    expect(stations?.schema.fields).toContainEqual(
      expect.objectContaining({
        id: "longitude",
        type: "longitude",
      }),
    );
    expect(stations?.schema.fields).toContainEqual(
      expect.objectContaining({
        id: "price",
        type: "number",
        unit: "EUR/l",
      }),
    );
    expect(stations?.schema.fields).toContainEqual(
      expect.objectContaining({
        id: "updatedAt",
        type: "datetime",
      }),
    );
    expect(stations?.records?.[0]).toMatchObject({
      entityKey: "66364",
      eventTime: "2026-09-01T07:35:00.000Z",
      payload: {
        id: "66364",
        name: "PA Casal Aranha",
        brand: "PRIO",
        municipality: "Torres Vedras",
        district: "Lisboa",
        latitude: 39.08039,
        longitude: -9.37184,
        price: 1.889,
        updatedAt: "2026-09-01T07:35:00.000Z",
      },
    });
  });

  it("creates one median point per municipality per day, with dimensions", () => {
    const transformed = transformer.transform(fixture("fuel-prices-lisbon.json"), context("fuel-prices"));
    const series = transformed.products[1];
    const loures = series?.points?.find((point) => point.seriesKey === "Loures");

    expect(series).toMatchObject({
      slug: "price-by-municipality-3201-district-11",
      role: "time-series",
      updateMode: "delta",
      watermark: "2026-09-07T00:00:00.000Z",
    });
    expect(loures).toEqual({
      seriesKey: "Loures",
      eventTime: "2026-09-07T00:00:00.000Z",
      value: 1.899,
      unit: "EUR/l",
      dimensions: { district: "Lisboa", municipality: "Loures" },
    });
    // An hour later the same prices are the same points: nothing new to record.
    const later = transformer.transform(fixture("fuel-prices-lisbon.json"), { ...context("fuel-prices"), observedAt: "2026-09-07T18:46:41Z" });
    expect(later.products[1]?.points).toEqual(series?.points);
  });

  it("is deterministic and rejects malformed station rows without losing valid rows", () => {
    const value = jsonAs<{ stations: JsonValue[] }>(fixture("fuel-prices-lisbon.json"));
    value.stations.push({ Id: 999, Nome: "Missing fields" });
    const bytes = new TextEncoder().encode(JSON.stringify(value));

    const first = transformer.transform(bytes, context("fuel-prices"));
    const second = transformer.transform(bytes, context("fuel-prices"));
    expect(second).toEqual(first);
    expect(first.quality).toEqual({
      acceptedRecords: 5,
      rejectedRecords: 1,
    });
  });
});
