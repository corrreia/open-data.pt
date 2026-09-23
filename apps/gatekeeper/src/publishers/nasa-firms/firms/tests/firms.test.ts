import { readFixtureBytes } from "#/tests/support";
import { describe, expect, it, vi } from "vitest";
import { FIRMS_API_ORIGIN, collectFirmsFeed, validateFirmsFeedConfig } from "#/publishers/nasa-firms/firms/index";

describe("NASA FIRMS source boundary", () => {
  it("normalizes its fixed configuration", () => {
    expect(validateFirmsFeedConfig({ feed: "hotspots", region: "mainland", product: "VIIRS_SNPP_NRT" })).toEqual({
      feed: "hotspots",
      region: "mainland",
      product: "VIIRS_SNPP_NRT",
    });
  });

  it("keeps the FIRMS map key out of provenance", async () => {
    const mapKey = "test_map_key_1234";
    const fetcher = vi.fn(async (input: URL | RequestInfo) => {
      expect(input.toString()).toContain(`/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/-9.6,36.8,-6.1,42.2/5`);
      return new Response(readFixtureBytes(new URL("./fixtures/hotspots.csv", import.meta.url)), { headers: { "content-type": "text/csv" } });
    });
    const fetched = await collectFirmsFeed({ feed: "hotspots", region: "mainland", product: "VIIRS_SNPP_NRT" }, FIRMS_API_ORIGIN, mapKey, fetcher);
    expect(fetched).toMatchObject({ kind: "body", completeness: "complete", provenance: { sourceUrl: `${FIRMS_API_ORIGIN}/api/area/` }, state: {} });
    if (fetched.kind !== "body") throw new Error("Expected FIRMS source body");
    expect(fetched.provenance.sourceUrl).not.toContain(mapKey);
  });

  it("rejects a failed upstream response and forwards its Retry-After", async () => {
    await expect(
      collectFirmsFeed(
        { feed: "hotspots", region: "mainland", product: "VIIRS_SNPP_NRT" },
        FIRMS_API_ORIGIN,
        "test_map_key_1234",
        async () => new Response("unavailable", { status: 503, headers: { "retry-after": "60" } }),
      ),
    ).rejects.toMatchObject({ code: "upstream-error", retryAfterSeconds: 60 });
  });
});
