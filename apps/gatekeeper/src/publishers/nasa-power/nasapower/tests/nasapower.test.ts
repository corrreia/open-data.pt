import { readFixtureBytes } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import { NASA_POWER_API_ORIGIN, collectNasaPowerFeed, validateNasaPowerFeedConfig } from "#/publishers/nasa-power/nasapower/index";

const now = new Date("2026-09-18T20:00:00Z");

describe("NASA POWER source boundary", () => {
  it("normalizes its fixed configuration", () => {
    expect(validateNasaPowerFeedConfig({ feed: "daily-region", region: "madeira", parameter: "ALLSKY_SFC_SW_DWN", days: "030" })).toEqual({
      feed: "daily-region",
      region: "madeira",
      parameter: "ALLSKY_SFC_SW_DWN",
      days: "30",
    });
  });

  it("builds a bounded rolling request", async () => {
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      const url = new URL(input.toString());
      expect(url.searchParams.get("start")).toBe("20260522");
      expect(url.searchParams.get("end")).toBe("20260620");
      expect(url.searchParams.get("time-standard")).toBe("UTC");
      return new Response(readFixtureBytes(new URL("./fixtures/daily-region.json", import.meta.url)), { headers: { "content-type": "application/json" } });
    });
    await expect(
      collectNasaPowerFeed({ feed: "daily-region", region: "mainland", parameter: "ALLSKY_SFC_SW_DWN", days: "30" }, undefined, NASA_POWER_API_ORIGIN, fetcher, now),
    ).resolves.toMatchObject({ kind: "body", completeness: "complete" });
  });

  it("rejects a malformed upstream response", async () => {
    await expect(
      collectNasaPowerFeed(
        { feed: "daily-region", region: "mainland", parameter: "ALLSKY_SFC_SW_DWN", days: "30" },
        undefined,
        NASA_POWER_API_ORIGIN,
        async () => new Response("not-json"),
        now,
      ),
    ).rejects.toMatchObject({ code: "invalid-response" });
  });
});
