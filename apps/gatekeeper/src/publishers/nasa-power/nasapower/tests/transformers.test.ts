import { readFixture, readFixtureBytes } from "#/tests/support";
import { describe, expect, it } from "vitest";
import type { TransformContext } from "@open-data-pt/contract";
import { NasaPowerTransformer } from "#/publishers/nasa-power/nasapower/index";

const FIXTURE = new URL("./fixtures/daily-region.json", import.meta.url);

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

const solar = () =>
  context("nasa-power-mainland-solar-resource-feed", { feed: "daily-region", region: "mainland", parameter: "ALLSKY_SFC_SW_DWN", days: "30" }, "observation", "time-series");

describe("NASA POWER normalizer", () => {
  it("turns NASA POWER grid values into one series per source cell and omits fill values", () => {
    const result = new NasaPowerTransformer().transform(readFixtureBytes(FIXTURE), solar());
    const product = result.products[0];
    expect(product).toMatchObject({ role: "time-series", updateMode: "source-window", watermark: "2026-09-16T00:00:00.000Z" });
    expect(product?.points).toHaveLength(5);
    expect(product?.points?.[0]).toEqual({
      seriesKey: "37.000,-9.375",
      eventTime: "2026-09-14T00:00:00.000Z",
      value: 5.12,
      unit: "kW-hr/m^2/day",
      dimensions: { parameter: "ALLSKY_SFC_SW_DWN", latitude: "37", longitude: "-9.375", elevationMetres: "1.46" },
    });
  });

  it("drops an impossible source calendar date", () => {
    const result = new NasaPowerTransformer().transform(new TextEncoder().encode(readFixture(FIXTURE).replaceAll("20260914", "20260230")), solar());
    expect(result.products[0]?.points).toHaveLength(3);
  });
});
