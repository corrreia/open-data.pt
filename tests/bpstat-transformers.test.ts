import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { TransformContext } from "@open-data-pt/gatekeeper-shared";
import { normalizeReferenceDate, transformBpstatDataset } from "../packages/gatekeeper-shared/src/sources/bpstat/transform";

function fixture(name: string): Uint8Array {
  return new Uint8Array(readFileSync(new URL(`./fixtures/bpstat/${name}`, import.meta.url)));
}

function context(slug: string, title: string): TransformContext {
  return {
    feed: {
      id: `feed_${slug}`,
      slug,
      title,
      description: "test feed",
      config: {
        domain: "12",
        dataset: "7f13efcd65fc6bd0c5adb0e8d29d9b44",
        lang: "EN",
      },
      semantics: {
        boundedness: "bounded",
        changeSemantics: "full-snapshot",
        cadence: "periodic",
        domainSubject: "observation",
        defaultProductRole: "reference",
        completeness: "complete",
        ordering: "none",
        eventTimeField: "time",
        entityKeyField: "dimension category codes",
      },
    },
    observedAt: "2026-09-07T18:26:53Z",
    sourcePublishedAt: "2026-08-20T16:00:00Z",
  };
}

describe("BPstat JSON-stat transformer", () => {
  it("decodes dense row-major values into one typed series product", () => {
    const result = transformBpstatDataset(fixture("cpi-page.json"), context("bpstat-cpi", "Consumer price index"));

    expect(result.transformer).toEqual({
      id: "bpstat-jsonstat-dataset",
      version: "4",
    });
    expect(result.quality).toEqual({
      acceptedRecords: 6,
      rejectedRecords: 0,
    });
    // Every value is published once: no record product repeats the points.
    expect(result.products.map(({ role, kind }) => [role, kind])).toEqual([["time-series", "series"]]);

    const series = result.products[0];
    expect(series).toMatchObject({
      slug: "bpstat-cpi-series",
      updateMode: "authoritative-snapshot",
      watermark: "2026-07-31T00:00:00Z",
    });
    expect(series?.points).toHaveLength(6);
    expect(series?.points?.[0]).toMatchObject({
      eventTime: "2026-05-31T00:00:00Z",
      value: 3.2,
      unit: "Percentage",
      dimensions: {
        "Consumption aggregates": "Food and non-alcoholic beverages",
      },
    });
    expect(series?.points?.[0]?.seriesKey).not.toContain("2026-05-31");
    // Single-category dimensions are facts about the dataset, not the rows.
    expect(series?.points?.[0]?.dimensions).not.toHaveProperty("Source");
    expect(series?.description).toContain("Source: Statistics Portugal");
    expect(series?.schema.fields.find(({ id }) => id === "value")?.unit).toBe("Percentage");
  });

  it("decodes sparse values without inventing null Cartesian cells", () => {
    const result = transformBpstatDataset(fixture("interest-rates.json"), context("bpstat-interest", "Housing loan reference rates"));

    expect(result.quality).toMatchObject({
      acceptedRecords: 6,
      rejectedRecords: 0,
    });
    expect(result.products).toHaveLength(1);
    expect(result.products[0]?.points).toHaveLength(6);
    expect(new Set(result.products[0]?.points?.map(({ seriesKey }) => seriesKey)).size).toBe(2);
    expect(result.products[0]?.points?.every(({ unit }) => unit === "Percentage")).toBe(true);
  });

  it("accepts paginated envelopes and deduplicates identical page-boundary observations", () => {
    const page = JSON.parse(new TextDecoder().decode(fixture("cpi-page.json")));
    const bytes = new TextEncoder().encode(JSON.stringify({ pages: [page, page] }));
    const result = transformBpstatDataset(bytes, context("bpstat-cpi", "Consumer price index"));
    expect(result.quality).toMatchObject({
      acceptedRecords: 6,
      rejectedRecords: 0,
    });
  });

  it("normalizes annual, quarterly, monthly, and exact reference dates", () => {
    expect(normalizeReferenceDate("2025")).toBe("2025-12-31");
    expect(normalizeReferenceDate("2025-Q1")).toBe("2025-03-31");
    expect(normalizeReferenceDate("2024-02")).toBe("2024-02-29");
    expect(normalizeReferenceDate("2026-07-31")).toBe("2026-07-31");
    expect(normalizeReferenceDate("2026-02-31")).toBeUndefined();
  });

  it("rejects malformed JSON-stat input", () => {
    expect(() => transformBpstatDataset(new TextEncoder().encode('{"class":"dataset"}'), context("bpstat-broken", "Broken"))).toThrow("JSON-stat 2.0");
  });
});

describe("BPstat pagination", () => {
  it("keeps a dimension that varies only on a later page out of the constants", () => {
    const base = JSON.parse(new TextDecoder().decode(fixture("cpi-page.json")));
    const page1 = structuredClone(base.pages ? base.pages[0] : base);
    delete page1.status; // status flags are per page in the real API; keep the pages comparable
    // Page 2 repeats the same aggregates and dates with a second Metrics category.
    const page2 = structuredClone(page1);
    const metrics = Object.keys(page2.dimension).find((id) => /metric/i.test(page2.dimension[id].label)) ?? Object.keys(page2.dimension)[1];
    const dim = page2.dimension[metrics];
    const [code] = dim.category.index;
    dim.category.index = [code, `${code}-mom`];
    dim.category.label = { ...dim.category.label, [`${code}-mom`]: "Month-on-month rate of change" };
    const metricsPos = page2.id.indexOf(metrics);
    const oldSize: number[] = page1.size;
    const newSize: number[] = [...oldSize];
    newSize[metricsPos] = 2;
    page2.size = newSize;
    // Re-lay the cells in row-major order for the new size: metric 0 keeps the
    // original value (a repeat of page 1), metric 1 gets a shifted value.
    const toCoords = (flat: number, size: number[]) => {
      const coords = Array.from<number>({ length: size.length });
      for (let i = size.length - 1; i >= 0; i -= 1) {
        coords[i] = flat % size[i]!;
        flat = Math.floor(flat / size[i]!);
      }
      return coords;
    };
    const toFlat = (coords: number[], size: number[]) => coords.reduce((acc, c, i) => acc * size[i]! + c, 0);
    const value2: Record<string, number> = {};
    // SAFETY: `page1.value` is the dense cell map this test just built.
    for (const [flat, v] of Object.entries(page1.value as Record<string, number>)) {
      const coords = toCoords(Number(flat), oldSize);
      value2[toFlat(coords, newSize)] = v;
      const shifted = [...coords];
      shifted[metricsPos] = 1;
      value2[toFlat(shifted, newSize)] = v + 100;
    }
    page2.value = value2;
    delete page2.status;
    const bytes = new TextEncoder().encode(JSON.stringify({ pages: [page1, page2] }));
    const result = transformBpstatDataset(bytes, context("bpstat-cpi", "CPI"));
    expect(result.quality.rejectedRecords).toBe(0);
    // The metrics dimension varies across pages, so it keys the series apart.
    const series = result.products[0]!;
    expect(series.points?.some((point) => point.seriesKey.includes(`${code}-mom`))).toBe(true);
  });
});
