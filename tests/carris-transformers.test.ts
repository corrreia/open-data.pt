import { describe, expect, it } from "vitest";
import { CarrisTransformer } from "../packages/gatekeeper-shared/src/sources/carris/transform";
import type {
  JsonValue,
  TransformContext,
} from "@open-data-pt/gatekeeper-shared";

function feed(kind: "alerts" | "lines" | "routes" | "stops" | "vehicles"): TransformContext["feed"] {
  return {
    id: `feed_${kind}`,
    slug: `carris-${kind}-feed`,
    title: kind,
    description: "test feed",
    config: { feed: kind },
    semantics: {
      boundedness: kind === "lines" ? "bounded" : "unbounded",
      changeSemantics: kind === "alerts" ? "keyed-upsert" : "full-snapshot",
      cadence: kind === "lines" ? "slow-changing" : "near-real-time",
      domainSubject:
        kind === "lines" ? "reference" : kind === "alerts" ? "event" : "observation",
      defaultProductRole:
        kind === "lines" ? "reference" : kind === "alerts" ? "event-log" : "current-state",
      completeness: "complete",
      ordering: kind === "lines" ? "none" : "per-entity",
    },
  };
}

const context = (kind: "alerts" | "lines" | "routes" | "stops" | "vehicles") => ({
  feed: feed(kind),
  observedAt: "2026-09-06T10:00:00Z",
  sourcePublishedAt: "2026-09-06T09:59:59Z",
});

function bytes(value: JsonValue | undefined): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("Carris transformers", () => {
  const transformer = new CarrisTransformer();

  it("creates a reference product from lines", () => {
    const result = transformer.transform(
      bytes([{ id: "1001", long_name: "A - B", short_name: "1001" }]),
      context("lines"),
    );
    expect(result.products[0]).toMatchObject({
      slug: "carris-lines",
      role: "reference",
      updateMode: "authoritative-snapshot",
    });
    expect(result.products[0]?.records?.[0]?.payload).toMatchObject({
      id: "1001",
      longName: "A - B",
    });
  });

  it("creates current state, summary, and time series from vehicles", () => {
    const result = transformer.transform(
      bytes([
        {
          id: "41|300",
          agency_id: "41",
          lat: 38.7,
          lon: -9.2,
          timestamp: 1788688740,
          propulsion: "electricity",
        },
        { id: "|undefined" },
      ]),
      context("vehicles"),
    );
    expect(result.quality).toMatchObject({
      acceptedRecords: 1,
      rejectedRecords: 1,
    });
    expect(result.products.map((product) => product.role)).toEqual([
      "current-state",
      "summary",
      "time-series",
    ]);
    expect(result.products[2]?.points?.[0]).toMatchObject({
      seriesKey: "all",
      value: 1,
      unit: "vehicle",
    });
  });

  it("keeps an old vehicle observation as an ordinary record whose event time shows its age", () => {
    const result = transformer.transform(
      bytes([
        { id: "41|300", agency_id: "41", lat: 38.7, lon: -9.2, timestamp: 1788688740 },
        { id: "41|301", agency_id: "41", lat: 38.71, lon: -9.21, timestamp: 1788678000 },
      ]),
      context("vehicles"),
    );
    const vehicles = result.products[0]?.records ?? [];
    expect(vehicles.map((record) => [record.entityKey, record.eventTime])).toEqual([
      ["41|300", "2026-09-06T09:59:00.000Z"],
      ["41|301", "2026-09-06T07:00:00.000Z"],
    ]);
    expect(result).not.toHaveProperty("lateRecords");
    expect(result.quality).toEqual({ acceptedRecords: 2, rejectedRecords: 0 });
    expect(result.products[2]?.points?.[0]).toMatchObject({ seriesKey: "all", value: 2 });
  });

  it("reads vehicle timestamps in milliseconds, as /v2/vehicles sends them since September 2026, and in seconds", () => {
    const result = transformer.transform(
      bytes([
        { id: "41|300", agency_id: "41", lat: 38.7, lon: -9.2, timestamp: 1788688740000 },
        { id: "41|301", agency_id: "41", lat: 38.71, lon: -9.21, timestamp: 1788688740 },
      ]),
      context("vehicles"),
    );
    expect(result.products[0]?.records?.map((record) => record.eventTime)).toEqual([
      "2026-09-06T09:59:00.000Z",
      "2026-09-06T09:59:00.000Z",
    ]);
    expect(result.products[2]?.points?.[0]?.eventTime).toBe("2026-09-06T09:59:00.000Z");
  });

  it("materializes vehicles as an object and keeps the fleet details the source now publishes", () => {
    const result = transformer.transform(
      bytes([
        {
          id: "41|300",
          agency_id: "41",
          lat: 38.7,
          lon: -9.2,
          timestamp: 1788688740,
          propulsion: "electricity",
          make: "CaetanoBus",
          model: "e.City Gold",
          owner: "SCOTTURB",
          license_plate: "AC-45-FH",
          capacity_total: 57,
          door_status: "OPEN",
          pattern_id: "1209_1_1",
          bikes_allowed: true,
        },
      ]),
      context("vehicles"),
    );
    const current = result.products[0];
    expect(current?.role).toBe("current-state");
    expect(current?.records?.[0]?.payload).toMatchObject({
      make: "CaetanoBus",
      model: "e.City Gold",
      owner: "SCOTTURB",
      licensePlate: "AC-45-FH",
      capacityTotal: 57,
      doorStatus: "OPEN",
      patternId: "1209_1_1",
      bikesAllowed: true,
    });
    const summary = result.products[1]?.records ?? [];
    expect(summary.map((record) => record.entityKey)).toEqual(["41", "all"]);
    expect(summary[1]?.payload).toMatchObject({ activeVehicles: 1, vehiclesByPropulsion: { electricity: 1 } });
  });

  it("creates reference products from routes and an object-materialized product from stops", () => {
    const routes = transformer.transform(
      bytes([{ id: "1001_0", line_id: "1001", long_name: "A - B", short_name: "1001", color: "#C61D23", municipality_ids: ["1115"], pattern_ids: ["1001_0_1"] }]),
      context("routes"),
    );
    expect(routes.products[0]?.records?.[0]?.payload).toMatchObject({ lineId: "1001", patternIds: ["1001_0_1"] });

    const stops = transformer.transform(
      bytes([
        { id: "7822", lat: 38.77, lon: -9.09, long_name: "Av. D. João II", municipality_id: "1106", wheelchair_boarding: false, line_ids: ["1001"] },
        { id: "broken", long_name: "no position" },
      ]),
      context("stops"),
    );
    expect(stops.quality).toMatchObject({ acceptedRecords: 1, rejectedRecords: 1 });
    expect(stops.products[0]?.records?.[0]?.payload).toMatchObject({ name: "Av. D. João II", latitude: 38.77, lineIds: ["1001"] });
  });

  it("dates an alert by when it takes effect, never by when it was polled", () => {
    const result = transformer.transform(
      bytes([
        {
          alert_id: "alert-1",
          active_period: [{ start: 1788490800, end: 1788494400 }],
          header_text: { translation: [{ language: "pt", text: "Desvio" }] },
          description_text: { translation: [{ language: "pt", text: "Rua fechada" }] },
          cause: "OTHER_CAUSE",
          effect: "DETOUR",
        },
      ]),
      context("alerts"),
    );
    const record = result.products[0]?.records?.[0];
    expect(record).toMatchObject({
      entityKey: "alert-1",
      operation: "upsert",
      eventTime: "2026-09-04T03:00:00.000Z",
      validFrom: "2026-09-04T03:00:00.000Z",
      validTo: "2026-09-04T04:00:00.000Z",
    });
    expect(record?.payload).toMatchObject({ title: "Desvio", description: "Rua fechada" });
    expect(result.products[0]?.watermark).toBe("2026-09-04T03:00:00.000Z");
    // Polled again later, the same alert is the same record: nothing about it changed.
    const later = transformer.transform(
      bytes([{ alert_id: "alert-1", active_period: [{ start: 1788490800, end: 1788494400 }], header_text: { translation: [{ language: "pt", text: "Desvio" }] }, description_text: { translation: [{ language: "pt", text: "Rua fechada" }] }, cause: "OTHER_CAUSE", effect: "DETOUR" }]),
      { ...context("alerts"), observedAt: "2026-09-06T10:05:00Z", sourcePublishedAt: "2026-09-06T10:04:59Z" },
    );
    expect(later.products[0]?.records?.[0]).toEqual(record);
  });

  it("leaves an alert without an active period undated", () => {
    const result = transformer.transform(bytes([{ alert_id: "alert-2", header_text: { translation: [{ language: "pt", text: "Aviso" }] } }]), context("alerts"));
    expect(result.products[0]?.records?.[0]?.eventTime).toBeUndefined();
    expect(result.products[0]?.watermark).toBeUndefined();
  });
});
