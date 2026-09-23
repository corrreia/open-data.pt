import { readFixture, readFixtureBytes } from "#/tests/support";
import { describe, expect, it } from "vitest";
import type { NormalizedRow, TransformContext } from "@open-data-pt/contract";
import { FirmsTransformer } from "#/publishers/nasa-firms/firms/index";

const FIXTURE = new URL("./fixtures/hotspots.csv", import.meta.url);

function context(
  slug: string,
  config: Record<string, string>,
  domainSubject: "event" | "observation" | "feature",
  defaultProductRole: "event-log" | "time-series" | "reference",
): TransformContext {
  return {
    feed: { slug, title: `${slug} title`, description: `${slug} description`, config, semantics: { domainSubject, defaultProductRole } },
    observedAt: "2026-09-18T20:00:00Z",
  };
}

const hotspots = () => context("nasa-firms-mainland-thermal-anomalies-feed", { feed: "hotspots", region: "mainland", product: "VIIRS_SNPP_NRT" }, "event", "event-log");

describe("NASA FIRMS normalizer", () => {
  it("streams FIRMS pixels with acquisition clocks and stable source-local keys", async () => {
    const transform = await new FirmsTransformer().transform(new Response(readFixtureBytes(FIXTURE)).body!, hotspots());
    const rows: NormalizedRow[] = [];
    for await (const row of transform.rows) rows.push(row);
    const summary = transform.finish();
    expect(rows).toHaveLength(2);
    expect(rows[0]?.record).toMatchObject({
      entityKey: "N|VIIRS|2026-09-18T13:25:00.000Z|40.12345|-8.54321",
      eventTime: "2026-09-18T13:25:00.000Z",
      payload: { brightness: 341.2, fireRadiativePower: 12.7, dayNight: "D" },
    });
    expect(summary).toEqual({
      quality: { acceptedRecords: 2, rejectedRecords: 0 },
      products: [{ productKey: "hotspots", watermark: "2026-09-18T13:25:00.000Z" }],
    });
  });

  it("rejects impossible source calendar dates", async () => {
    const firms = await new FirmsTransformer().transform(new Response(readFixture(FIXTURE).replaceAll("2026-09-18", "2026-02-30")).body!, hotspots());
    const rows: NormalizedRow[] = [];
    for await (const row of firms.rows) rows.push(row);
    expect(rows).toEqual([]);
    expect(firms.finish().quality).toEqual({ acceptedRecords: 0, rejectedRecords: 2 });
  });
});
