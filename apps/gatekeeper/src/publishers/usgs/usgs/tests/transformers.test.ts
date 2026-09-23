import { readFixture, readFixtureBytes } from "#/tests/support";
import { describe, expect, it } from "vitest";
import type { TransformContext } from "@open-data-pt/contract";
import { UsgsTransformer } from "#/publishers/usgs/usgs/index";

const FIXTURE = new URL("./fixtures/earthquakes.json", import.meta.url);

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

const earthquakes = () => context("usgs-mainland-portugal-earthquakes-feed", { feed: "earthquakes", region: "mainland", days: "30", minMagnitude: "1" }, "event", "event-log");

describe("USGS normalizer", () => {
  it("normalizes USGS corrections and source clocks", () => {
    const result = new UsgsTransformer().transform(readFixtureBytes(FIXTURE), earthquakes());
    expect(result.products[0]).toMatchObject({ role: "event-log", updateMode: "source-window" });
    expect(result.products[0]?.records?.[0]).toMatchObject({
      entityKey: "us7000pe8k",
      eventTime: "2025-02-17T13:24:04.559Z",
      sourcePublishedAt: "2025-05-02T16:26:20.040Z",
      payload: { magnitude: 4.8, depth: 10, latitude: 38.6301, longitude: -9.1842, status: "reviewed", tsunami: false },
    });
  });

  it("rejects an out-of-range epoch", () => {
    const result = new UsgsTransformer().transform(new TextEncoder().encode(readFixture(FIXTURE).replaceAll("1739798644559", "9007199254740991")), earthquakes());
    expect(result.quality).toEqual({ acceptedRecords: 0, rejectedRecords: 1 });
  });
});
