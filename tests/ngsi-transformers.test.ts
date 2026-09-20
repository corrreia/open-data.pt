import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TransformContext } from "@open-data-pt/gatekeeper-shared";
import { NgsiTransformer } from "../packages/gatekeeper-shared/src/formats/ngsi";

function fixture(path: string): Uint8Array {
  return readFileSync(new URL(`./fixtures/${path}`, import.meta.url));
}

function context(slug: string, config: Record<string, string>, domainSubject: "observation" | "feature"): TransformContext {
  return {
    feed: { slug, title: `${slug} title`, description: `${slug} description`, config, semantics: { domainSubject, defaultProductRole: "current-state" } },
    observedAt: "2026-09-20T18:20:00Z",
  };
}

const OBSERVATIONS = {
  feed: "observations",
  host: "broker.fiware.urbanplatform.portodigital.pt",
  entityType: "AirQualityObserved",
  timeField: "dateObserved",
  measures: "co,no2,o3,pm10,pm25,pm1,temperature",
};

describe("the NGSI transformer", () => {
  it("publishes the readings as series and the sensors as a table, with no number in both", () => {
    const result = new NgsiTransformer().transform(fixture("ngsi/porto-air-quality.json"), context("porto-air-quality-feed", OBSERVATIONS, "observation"));
    const sensors = result.products.find((product) => product.productKey === "sensors");
    const observations = result.products.find((product) => product.productKey === "observations");

    // Three sensors: five pollutants each, and two extra measurements between them, because
    // what a sensor reports is its own business and the feed names every measurement it might.
    expect(sensors?.records).toHaveLength(3);
    expect(observations?.points).toHaveLength(17);
    expect(observations).toMatchObject({ role: "time-series", updateMode: "delta" });

    // The measurements live in the series and nowhere else: the table holds only what a sensor is.
    const measured = new Set(["co", "no2", "o3", "pm10", "pm25", "pm1", "temperature"]);
    for (const field of sensors?.schema.fields ?? []) expect(measured.has(field.id)).toBe(false);
    expect(sensors?.schema.fields.map((field) => field.id)).toEqual(["latitude", "longitude", "name", "observedAt"]);

    // Each point is dated by the sensor's own clock, never by when we polled.
    for (const point of observations?.points ?? []) expect(point.eventTime).not.toBe("2026-09-20T18:20:00Z");
    expect(observations?.points?.[0]?.eventTime).toBe("2022-11-18T14:40:00.000Z");
    // The broker states no unit for a pollutant, so none is invented.
    expect(observations?.points?.[0]?.unit).toBe("");
  });

  it("keeps a sensor that stopped reporting years ago, and says when it last spoke", () => {
    const result = new NgsiTransformer().transform(fixture("ngsi/porto-air-quality.json"), context("porto-air-quality-feed", OBSERVATIONS, "observation"));
    const sensors = result.products.find((product) => product.productKey === "sensors");
    // A dead sensor is not a rejected row: which of a city's sensors are still alive is the
    // question this table answers, and it can only answer it by carrying the silent ones too.
    expect(sensors?.records?.map((record) => record.payload.observedAt)).toContain("2022-11-18T14:40:00.000Z");
    expect(result.quality).toMatchObject({ rejectedRecords: 0 });
  });

  it("names a measure's unit only where the example states one", () => {
    const result = new NgsiTransformer().transform(
      fixture("ngsi/porto-air-quality.json"),
      context("porto-noise-levels-feed", { ...OBSERVATIONS, measures: "pm25=µg/m³" }, "observation"),
    );
    const observations = result.products.find((product) => product.productKey === "observations");
    expect(observations?.points).toHaveLength(3);
    for (const point of observations?.points ?? []) expect(point.unit).toBe("µg/m³");
  });

  it("reads an inventory as one dated table", () => {
    const result = new NgsiTransformer().transform(
      fixture("ngsi/porto-air-quality.json"),
      context(
        "porto-inventory-feed",
        { feed: "inventory", host: "broker.fiware.urbanplatform.portodigital.pt", entityType: "AirQualityObserved", timeField: "dateObserved" },
        "feature",
      ),
    );
    expect(result.products).toHaveLength(1);
    const entities = result.products[0];
    expect(entities).toMatchObject({ productKey: "entities", role: "current-state", updateMode: "authoritative-snapshot" });
    // An inventory keeps every attribute, measurements included: nothing is published twice
    // because there is no series beside it.
    expect(entities?.schema.fields.map((field) => field.id)).toContain("pm25");
    expect(entities?.records?.[0]?.eventTime).toBe("2022-11-18T14:40:00.000Z");
  });
});
