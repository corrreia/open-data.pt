import { jsonAs, readFixtureBytes } from "#/tests/support";
import { describe, expect, it } from "vitest";
import type { JsonObject, JsonValue, TransformContext } from "@open-data-pt/contract";
import { normalizeReferenceDate, transformBpstatDataset } from "#/publishers/banco-de-portugal/bpstat/transform";

function fixture(name: string): Uint8Array {
  return readFixtureBytes(new URL(`./fixtures/${name}`, import.meta.url));
}

/** The parts of a JSON-stat page this test rewrites; the rest of the page is carried through untouched. */
interface JsonStatPage {
  id: string[];
  size: number[];
  value: Record<string, number>;
  status?: JsonValue;
  dimension: Record<string, { label: string; category: { index: string[]; label?: Record<string, string> } }>;
}

function context(slug: string, title: string): TransformContext {
  return {
    feed: {
      slug,
      title,
      description: "test feed",
      config: {
        domain: "12",
        dataset: "7f13efcd65fc6bd0c5adb0e8d29d9b44",
        lang: "EN",
      },
      semantics: {
        domainSubject: "observation",
        defaultProductRole: "reference",
      },
    },
    observedAt: "2026-09-07T18:26:53Z",
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
    const page = jsonAs<JsonObject>(fixture("cpi-page.json"));
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
    const page1 = jsonAs<JsonStatPage>(fixture("cpi-page.json"));
    delete page1.status; // status flags are per page in the real API; keep the pages comparable
    // Page 2 repeats the same aggregates and dates with a second Metrics category.
    const page2 = structuredClone(page1);
    const metrics = Object.entries(page2.dimension).find(([, dimension]) => /metric/i.test(dimension.label))?.[0] ?? Object.keys(page2.dimension)[1];
    const dim = metrics === undefined ? undefined : page2.dimension[metrics];
    if (metrics === undefined || dim === undefined) throw new Error("The fixture has no metrics dimension");
    const [code] = dim.category.index;
    if (code === undefined) throw new Error("The metrics dimension has no category");
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
    for (const [flat, v] of Object.entries(page1.value)) {
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
