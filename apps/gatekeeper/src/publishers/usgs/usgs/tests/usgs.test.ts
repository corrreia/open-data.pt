import { readFixtureBytes } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import { USGS_API_ORIGIN, collectUsgsFeed, validateUsgsFeedConfig } from "#/publishers/usgs/usgs/index";

const now = new Date("2026-09-18T20:00:00Z");

describe("USGS source boundary", () => {
  it("normalizes its fixed configuration", () => {
    expect(validateUsgsFeedConfig({ feed: "earthquakes", region: "azores", days: "030", minMagnitude: "1.0" })).toEqual({
      feed: "earthquakes",
      region: "azores",
      days: "30",
      minMagnitude: "1",
    });
  });

  it("builds a bounded rolling request", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.searchParams.get("starttime")).toBe("2026-08-19T20:00:00.000Z");
      expect(url.searchParams.get("endtime")).toBe("2026-09-18T20:00:00.000Z");
      expect(url.searchParams.get("minlatitude")).toBe("36.8");
      return new Response(readFixtureBytes(new URL("./fixtures/earthquakes.json", import.meta.url)), { headers: { "content-type": "application/geo+json" } });
    });
    await expect(collectUsgsFeed({ feed: "earthquakes", region: "mainland", days: "30", minMagnitude: "1" }, undefined, USGS_API_ORIGIN, fetcher, now)).resolves.toMatchObject({
      kind: "body",
      completeness: "complete",
    });
  });

  it("rejects a malformed upstream response", async () => {
    await expect(
      collectUsgsFeed({ feed: "earthquakes", region: "mainland", days: "30", minMagnitude: "1" }, undefined, USGS_API_ORIGIN, async () => new Response("not-json"), now),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });
});
