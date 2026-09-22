import { jsonAs } from "./support";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isJsonString } from "@open-data-pt/contract";
import type { JsonObject, TransformContext } from "@open-data-pt/contract";
import { GbfsTransformer } from "../apps/gatekeeper/src/formats/gbfs/transform";
import { prepareRecord } from "../apps/kernel/src/records";

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/gbfs/${name}.json`, import.meta.url)));
}

function context(slug: string, language = "en", feed = "status"): TransformContext {
  return {
    feed: {
      id: `feed_${slug}`,
      slug,
      title: slug,
      description: "test feed",
      config: {
        url: `https://example.invalid/${slug}/gbfs.json`,
        language,
        feed,
      },
      semantics: {
        boundedness: "bounded",
        changeSemantics: "full-snapshot",
        cadence: "near-real-time",
        domainSubject: "observation",
        defaultProductRole: "current-state",
        completeness: "complete",
        ordering: "none",
        eventTimeField: "last_reported",
        entityKeyField: "bike_id or vehicle_id",
      },
    },
    observedAt: "2026-09-07T21:00:00.000Z",
    sourcePublishedAt: "2026-09-07T20:59:00.000Z",
  };
}

describe("GBFS transformers", () => {
  const transformer = new GbfsTransformer();

  it("transforms a GBFS 1.0 Lime status snapshot into vehicles, availability, and a fleet series", () => {
    const result = transformer.transform(fixture("lime-lisbon"), context("lime-lisbon"));

    expect(result.transformer).toEqual({ id: "gbfs", version: "3" });
    expect(result.products.map((product) => [product.slug, product.role])).toEqual([
      ["lime-lisbon-vehicles", "current-state"],
      ["lime-lisbon-stations", "current-state"],
      ["lime-lisbon-fleet", "time-series"],
    ]);
    const vehicle = result.products[0]?.records?.[0];
    expect(vehicle).toMatchObject({
      entityKey: "a4c0e016-e09e-4a9f-a739-efde975cf697",
      eventTime: "2026-09-07T20:57:00.000Z",
      payload: {
        latitude: 38.7144,
        longitude: -9.1442,
        isReserved: false,
        isDisabled: false,
        vehicleType: "scooter:unknown",
        lastReported: null,
      },
    });
    expect(result.products[1]?.records?.[0]?.payload).toEqual({
      id: "lisbon",
      numBikesAvailable: 2548,
      numDocksAvailable: 999999,
      isInstalled: true,
      isRenting: true,
      isReturning: true,
    });
    expect(result.products[2]?.points).toContainEqual({
      seriesKey: "scooter:unknown",
      eventTime: "2026-09-07T20:57:00.000Z",
      value: 4,
      unit: "vehicles",
      dimensions: { system: "lime_lisbon" },
    });
    expect(result.products[0]).toMatchObject({
      updateMode: "authoritative-snapshot",
    });
  });

  it("publishes the system and the station descriptions from the reference part alone", () => {
    const result = transformer.transform(fixture("lime-lisbon"), context("lime-lisbon-reference", "en", "reference"));

    expect(result.products.map((product) => [product.slug, product.role])).toEqual([
      ["lime-lisbon-reference-stations", "reference"],
      ["lime-lisbon-reference-system", "reference"],
    ]);
    expect(result.products[0]?.records?.[0]?.payload).toEqual({
      id: "lisbon",
      name: "Lisbon",
      latitude: 38.6779,
      longitude: -9.1598,
      address: null,
      capacity: null,
    });
    expect(result.products[1]?.records?.[0]?.payload).toMatchObject({ systemId: "lime_lisbon" });
  });

  it("keeps each value in one part only: no positions in availability, no counts in the reference", () => {
    const status = transformer.transform(fixture("bird-lisbon"), context("bird-lisbon"));
    const reference = transformer.transform(fixture("bird-lisbon"), context("bird-lisbon-reference", "en", "reference"));
    const availability = status.products.find((product) => product.productKey === "stations");
    const stations = reference.products.find((product) => product.productKey === "stations");

    expect(availability?.schema.fields.map((entry) => entry.id)).toEqual(["id", "numBikesAvailable", "numDocksAvailable", "isInstalled", "isRenting", "isReturning"]);
    expect(stations?.schema.fields.map((entry) => entry.id)).toEqual(["id", "name", "latitude", "longitude", "address", "capacity"]);
    expect(status.products.some((product) => product.productKey === "system")).toBe(false);
    expect(reference.products.some((product) => product.kind === "series")).toBe(false);
    const keys = new Set(stations?.schema.fields.map((entry) => entry.id));
    expect(availability?.schema.fields.filter((entry) => entry.id !== "id").some((entry) => keys.has(entry.id))).toBe(false);
  });

  it("decodes GBFS 2.3 vehicle types and normalizes fuel fraction to percent", () => {
    const result = transformer.transform(fixture("bird-lisbon"), context("bird-lisbon"));
    const vehicles = result.products[0];
    const fleet = result.products[2];

    expect(result.products.map((product) => product.title)).toEqual(["Bird vehicles in Lisbon", "Bird station availability in Lisbon", "Bird fleet over time in Lisbon"]);
    expect(vehicles?.records).toHaveLength(4);
    expect(vehicles?.records?.[0]?.payload).toMatchObject({
      vehicleType: "scooter:electric",
      currentRangeMeters: 26496,
      batteryPercent: 78.41,
      isReserved: true,
    });
    expect(fleet?.points).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          seriesKey: "scooter:electric",
          value: 2,
          unit: "vehicles",
        }),
        expect.objectContaining({
          seriesKey: "bicycle:electric_assist",
          value: 0,
          unit: "vehicles",
        }),
        expect.objectContaining({ seriesKey: "reserved", value: 2 }),
        expect.objectContaining({ seriesKey: "disabled", value: 0 }),
      ]),
    );
    const system = transformer.transform(fixture("bird-lisbon"), context("bird-lisbon-reference", "en", "reference"));
    expect(system.products[1]?.records?.[0]?.payload).toMatchObject({
      systemId: "bird-lisbon",
      name: "bird lisbon",
      operator: "Bird Rides, Inc.",
      timezone: "Europe/Lisbon",
      licenceUrl: expect.stringContaining("GBFS-Data-License"),
    });
  });

  it("supports GBFS 3.0 vehicle_status and localized station names", () => {
    const bytes = fixture("bora-viseu");
    const ctx = context("bora-viseu", "pt");
    const first = transformer.transform(bytes, ctx);
    const second = transformer.transform(bytes, ctx);

    expect(second).toEqual(first);
    expect(first.products[0]?.records?.[0]).toMatchObject({
      entityKey: "bike_190481_1788814206077",
      eventTime: "2026-09-07T20:50:06.076Z",
      payload: {
        vehicleType: "bicycle:electric_assist",
        vehicleTypeId: "bora_bike",
        lastReported: "2026-09-07T20:50:06.076Z",
      },
    });
    expect(first.products[1]?.records?.[0]?.payload).toMatchObject({
      id: "378",
      numBikesAvailable: 4,
      numDocksAvailable: 1,
    });
    expect(first.products[2]?.points).toContainEqual({
      seriesKey: "bicycle:electric_assist",
      eventTime: "2026-09-07T20:50:06.076Z",
      value: 4,
      unit: "vehicles",
      dimensions: { system: "bora_viseu" },
    });
    const reference = transformer.transform(bytes, context("bora-viseu-reference", "pt", "reference"));
    expect(reference.products[0]?.records?.[0]?.payload).toMatchObject({
      id: "378",
      name: "Aguiar Beira - Esc. Padre J. Fonseca",
      capacity: 5,
    });
  });

  it("gives a station whose counts did not move the same semantic hash, whatever last_reported says", () => {
    const hashes = (name: string): string[] => {
      const result = transformer.transform(fixture(name), context("tubabike-barcelos", "pt"));
      const stations = result.products.find((product) => product.productKey === "stations");
      return (stations?.records ?? []).map((record) => prepareRecord(record).hash);
    };
    const before = hashes("tubabike-barcelos-status");

    expect(before).toHaveLength(3);
    expect(hashes("tubabike-barcelos-status-restamped")).toEqual(before);
  });

  it("still revises a station whose counts really moved", () => {
    const result = transformer.transform(fixture("tubabike-barcelos-status"), context("tubabike-barcelos", "pt"));
    const station = result.products.find((product) => product.productKey === "stations")?.records?.[0];
    if (!station) throw new Error("The TubaBike status fixture must carry stations");
    const moved = { ...station, payload: { ...station.payload, numBikesAvailable: 99 } };

    expect(prepareRecord(moved).hash).not.toBe(prepareRecord(station).hash);
  });

  it("derives operator and location titles from a new live TubaBike fixture", () => {
    const result = transformer.transform(fixture("tubabike-barcelos-status"), context("tubabike-barcelos", "pt"));
    const reference = transformer.transform(fixture("tubabike-barcelos-reference"), context("tubabike-barcelos-reference", "pt", "reference"));

    expect(result.products.map((product) => product.title)).toEqual([
      "TubaBike vehicles in Barcelos",
      "TubaBike station availability in Barcelos",
      "TubaBike fleet over time in Barcelos",
    ]);
    expect(reference.products.map((product) => product.title)).toEqual(["TubaBike stations in Barcelos", "TubaBike system information in Barcelos"]);
    expect(result.products[0]?.records).toHaveLength(3);
    expect(result.products[1]?.records).toHaveLength(3);
    expect(reference.products[0]?.records).toHaveLength(3);
  });

  it("falls back to a capitalised feed slug only without system information", () => {
    const document = jsonAs<JsonObject>(fixture("bird-lisbon"));
    delete document.system_information;

    const result = transformer.transform(new TextEncoder().encode(JSON.stringify(document)), context("coastal-share"));

    expect(result.products.map((product) => product.title)).toEqual(["Coastal Share vehicles", "Coastal Share station availability", "Coastal Share fleet over time"]);
    expect(result.products.some((product) => product.role === "reference")).toBe(false);
  });

  it("types every published schema field for source-agnostic rendering", () => {
    const status = transformer.transform(fixture("bird-lisbon"), context("bird-lisbon"));
    const reference = transformer.transform(fixture("bird-lisbon"), context("bird-lisbon-reference", "en", "reference"));
    const fields = [...status.products, ...reference.products].flatMap((product) => product.schema.fields);

    expect(fields.every((field) => isJsonString(field.type))).toBe(true);
    expect(fields.find((field) => field.id === "latitude")?.type).toBe("latitude");
    expect(fields.find((field) => field.id === "longitude")?.type).toBe("longitude");
    expect(fields.find((field) => field.id === "vehicleType")?.type).toBe("category");
    expect(fields.find((field) => field.id === "batteryPercent")?.type).toBe("number");
    expect(fields.find((field) => field.id === "lastReported")?.type).toBe("datetime");
    expect(fields.find((field) => field.id === "licenceUrl")?.type).toBe("url");
  });
});
