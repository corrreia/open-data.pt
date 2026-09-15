import { describe, expect, it } from "vitest";
import { cacheTtl, productTtl } from "../apps/kernel/src/cache";

const NOW = Date.parse("2026-09-10T12:00:00.000Z");
const at = (path: string) => cacheTtl(new URL(`https://open-data.pt${path}`), NOW);

describe("edge cache lifetimes", () => {
  it("caches history windows that ended over an hour ago for a day", () => {
    expect(at("/api/products/seismic/events?from=2026-07-01T00:00:00Z&to=2026-07-10T00:00:00Z")).toBe(86_400);
    expect(at("/api/products/load/series/range?from=2026-09-01T00:00:00Z&to=2026-09-10T10:00:00Z")).toBe(86_400);
    expect(at("/api/products/load/series/range?from=2026-08-01T00:00:00Z&knownAt=2026-08-15T00:00:00Z&to=2026-09-01T00:00:00Z")).toBe(86_400);
    expect(at("/api/products/load/series/changes/range?from=2026-08-01T00:00:00Z&to=2026-09-01T00:00:00Z")).toBe(86_400);
  });

  it("keeps windows that touch the last hour, or know-at times in it, short", () => {
    expect(at("/api/products/seismic/events?from=2026-09-10T00:00:00Z&to=2026-09-10T11:30:00Z")).toBe(300);
    expect(at("/api/products/seismic/changes/range?from=2026-07-01T00:00:00Z&to=2026-07-10T00:00:00Z&knownAt=2026-09-10T11:59:00Z")).toBe(300);
    expect(at("/api/products/seismic/events?from=bad&to=bad")).toBe(300);
    expect(at("/api/products/load/series/changes/range?from=2026-09-10T00:00:00Z&to=2026-09-10T12:00:00Z")).toBe(300);
  });

  it("keeps current reads near real time and leaves unknown routes uncached", () => {
    expect(at("/api/products/vehicles/records")).toBe(15);
    expect(at("/api/products/vehicles/records?where=line%3A728")).toBe(15);
    expect(at("/api/products")).toBe(20);
    expect(at("/api/usage")).toBeUndefined();
    expect(at("/api/acquisitions?day=2026-09-01")).toBe(300);
    expect(at("/api/feeds/feed_1/collect")).toBeUndefined();
    expect(at("/api/transform-runs")).toBeUndefined();
  });

  it("keeps a closed month's summary for a year, and a summary window that may still grow for an hour", () => {
    expect(at("/api/products/load/series/summary/2026-07")).toBe(31_536_000);
    expect(at("/api/products/load/series/summary/2026-08")).toBe(31_536_000);
    expect(at("/api/products/load/series/summary/2026-09")).toBe(3_600);
    expect(at("/api/products/load/series/summary?from=2026-06-01T00:00:00Z&to=2026-09-01T00:00:00Z")).toBe(86_400);
    expect(at("/api/products/load/series/summary?from=2026-09-01T00:00:00Z&to=2026-09-10T00:00:00Z")).toBe(3_600);
  });

  it("keeps a product that changes rarely for a quarter of its cadence, never past five minutes", () => {
    expect(productTtl(15, 60)).toBe(15);
    expect(productTtl(15, 600)).toBe(150);
    expect(productTtl(20, 3600)).toBe(300);
    expect(productTtl(15, 86_400)).toBe(300);
    expect(productTtl(15, undefined)).toBe(15);
  });
});
