import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { CanonicalRecord, JsonValue, TransformContext } from "@open-data-pt/gatekeeper-shared";
import { prepareRecord } from "../apps/kernel/src/records";
import { IpmaTransformer } from "../packages/gatekeeper-shared/src/sources/ipma/transform";

type FeedKind = "warnings" | "uv-index" | "fire-risk" | "sea-forecast";

function fixture(name: FeedKind): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/ipma-more/${name}.json`, import.meta.url)));
}

function bytes(value: JsonValue | undefined): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

function context(kind: FeedKind): TransformContext {
  const event = kind === "warnings";
  return {
    feed: {
      id: `feed_${kind}`,
      slug: `ipma-${kind}-feed`,
      title: kind,
      description: "test feed",
      config: { feed: kind },
      semantics: {
        boundedness: "bounded",
        changeSemantics: event ? "keyed-upsert" : "full-snapshot",
        cadence: "periodic",
        domainSubject: event ? "event" : "observation",
        defaultProductRole: event ? "event-log" : kind === "fire-risk" ? "current-state" : "reference",
        completeness: "complete",
        ordering: kind === "sea-forecast" ? "none" : "per-entity",
      },
    },
    observedAt: "2026-09-07T20:55:55.000Z",
  };
}

describe("IPMA additional transformers", () => {
  const transformer = new IpmaTransformer();

  it("maps warning areas, Lisbon DST timestamps, levels, colours, and change history", async () => {
    const result = await transformer.transform(fixture("warnings"), context("warnings"));
    const product = result.products[0];
    const yellow = product?.records?.find((record) => record.payload.level === "yellow");

    expect(result.transformer).toEqual({ id: "ipma-open-data", version: "3" });
    expect(product).toMatchObject({
      slug: "ipma-warnings",
      role: "event-log",
      updateMode: "source-window",
    });
    expect(product?.records?.[0]?.eventTime).toBe("2026-09-07T17:36:00.000Z");
    expect(yellow).toMatchObject({
      operation: "upsert",
      validFrom: "2026-09-07T17:36:00.000Z",
      payload: {
        area: "Évora",
        areaCode: "EVR",
        level: "yellow",
        levelColor: "#f9a825",
      },
    });
    expect(product?.schema.fields.find((field) => field.id === "level")?.display).toEqual({ badge: { colorField: "levelColor" } });
  });

  it("converts a DST-transition day and maps every warning level colour", async () => {
    const levels = ["green", "yellow", "orange", "red"] as const;
    const result = await transformer.transform(
      bytes({
        warnings: levels.map((level, index) => ({
          text: `warning ${level}`,
          awarenessTypeName: `Type ${index}`,
          idAreaAviso: "LSB",
          startTime: "2026-03-29T12:00:00",
          endTime: "2026-03-29T13:00:00",
          awarenessLevelID: level,
        })),
        areas: { data: [{ idAreaAviso: "LSB", local: "Lisboa" }] },
      }),
      context("warnings"),
    );

    expect(result.products[0]?.records?.map((record) => record.eventTime)).toEqual(Array(4).fill("2026-03-29T11:00:00.000Z"));
    expect(Object.fromEntries(result.products[0]?.records?.map((record) => [record.payload.level, record.payload.levelColor]) ?? [])).toEqual({
      green: "#2e7d32",
      yellow: "#f9a825",
      orange: "#ef6c00",
      red: "#c62828",
    });
  });

  it("creates UV forecast records with city coordinates, published once without a restated series", async () => {
    const result = await transformer.transform(fixture("uv-index"), context("uv-index"));
    const [reference] = result.products;

    expect(result.products).toHaveLength(1);

    expect(reference).toMatchObject({ slug: "ipma-uv-index", role: "reference", updateMode: "authoritative-snapshot" });
    expect(reference?.records?.[0]?.payload).toMatchObject({
      location: "Horta",
      latitude: 38.5363,
      longitude: -28.6315,
      date: "2026-09-07",
      period: "12h-15h",
      uvIndex: 7,
    });
    expect(reference?.watermark).toBeDefined();
  });

  it("creates three-day fire-risk records with labels, colours, and municipality fallback", async () => {
    const result = await transformer.transform(fixture("fire-risk"), context("fire-risk"));
    const product = result.products[0];

    expect(product).toMatchObject({ slug: "ipma-fire-risk", role: "current-state", updateMode: "authoritative-snapshot" });
    expect(product?.records).toHaveLength(6);
    expect(product?.records?.find((record) => record.entityKey === "0105:2026-09-07")?.payload).toMatchObject({
      municipalityCode: "0105",
      municipality: "Aveiro",
      riskLevel: 1,
      riskLabel: "Reduzido",
      riskColor: "#2e7d32",
      forecastDate: "2026-09-07",
    });
    expect(product?.records?.find((record) => record.entityKey === "0101:2026-09-07")?.payload).toMatchObject({
      municipality: "0101",
      riskLabel: "Moderado",
      riskColor: "#f9a825",
    });
    expect(product?.schema.fields.find((field) => field.id === "riskLabel")?.display).toEqual({ badge: { colorField: "riskColor" } });
  });

  it("maps every fire-risk level to its Portuguese label and colour", async () => {
    const levels = [1, 2, 3, 4, 5];
    const result = await transformer.transform(
      bytes({
        forecasts: [
          {
            dataPrev: "2026-09-07",
            local: Object.fromEntries(levels.map((level) => [`000${level}`, { data: { rcm: level }, dico: `000${level}`, latitude: 38 + level / 10, longitude: -9 }])),
          },
        ],
        municipalities: { data: [] },
      }),
      context("fire-risk"),
    );

    expect(Object.fromEntries(result.products[0]?.records?.map((record) => [record.payload.riskLevel, [record.payload.riskLabel, record.payload.riskColor]]) ?? [])).toEqual({
      1: ["Reduzido", "#2e7d32"],
      2: ["Moderado", "#f9a825"],
      3: ["Elevado", "#ef6c00"],
      4: ["Muito elevado", "#c62828"],
      5: ["Máximo", "#6a1b9a"],
    });
  });

  it("maps sea locations and types every wave and temperature measure", async () => {
    const result = await transformer.transform(fixture("sea-forecast"), context("sea-forecast"));
    const product = result.products[0];

    expect(product).toMatchObject({ slug: "ipma-sea-forecast", role: "reference", updateMode: "authoritative-snapshot" });
    expect(product?.records).toHaveLength(6);
    expect(product?.records?.[0]?.payload).toMatchObject({
      location: "Figueira da Foz, Costa",
      latitude: 40.1417,
      longitude: -8.8783,
      forecastDate: "2026-09-07",
      waveDirection: "NW",
      wavePeriodMin: 5.4,
      totalSeaMax: 2,
      waveHeightMax: 1.7,
      seaSurfaceTemperatureMax: 20,
    });
    expect(product?.schema.fields.find((field) => field.id === "wavePeriodMin")?.unit).toBe("s");
    expect(product?.schema.fields.find((field) => field.id === "totalSeaMax")?.unit).toBe("m");
    expect(product?.schema.fields.find((field) => field.id === "seaSurfaceTemperatureMax")?.unit).toBe("°C");
  });

  it("gives an unchanged sea forecast the same semantic hash after IPMA restates the document hour", async () => {
    const restated = new TextEncoder().encode(
      new TextDecoder().decode(fixture("sea-forecast")).replaceAll('"dataUpdate": "2026-09-07T20:31:01"', '"dataUpdate": "2026-09-07T21:31:04"'),
    );
    const first = await transformer.transform(fixture("sea-forecast"), context("sea-forecast"));
    const second = await transformer.transform(restated, context("sea-forecast"));
    const hashes = (records: CanonicalRecord[] | undefined): string[] => (records ?? []).map((record) => prepareRecord(record).hash);

    expect(hashes(first.products[0]?.records)).toHaveLength(6);
    expect(hashes(second.products[0]?.records)).toEqual(hashes(first.products[0]?.records));
  });
});
