import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { TransformContext } from "@open-data-pt/contract";
import { GbfsTransformer } from "@open-data-pt/gatekeeper/formats/gbfs";
import { prepareRecord } from "../apps/kernel/src/records";

/** A saved GBFS document, from the fixtures beside the format's own tests. */
function fixture(name: string): Uint8Array {
  const url = new URL(`../apps/gatekeeper/src/formats/gbfs/tests/fixtures/${name}.json`, import.meta.url);
  return new Uint8Array(readFileSync(fileURLToPath(url.href)));
}

function context(slug: string, language = "en", feed = "status"): TransformContext {
  return {
    feed: {
      slug,
      title: slug,
      description: "test feed",
      config: {
        url: `https://example.invalid/${slug}/gbfs.json`,
        language,
        feed,
      },
      semantics: {
        domainSubject: "observation",
        defaultProductRole: "current-state",
      },
    },
    observedAt: "2026-09-07T21:00:00.000Z",
  };
}

describe("GBFS records as the kernel hashes them", () => {
  const transformer = new GbfsTransformer();

  it("gives a station whose counts did not move the same semantic hash, whatever last_reported says", () => {
    const hashes = (name: string): string[] => {
      const result = transformer.transform(fixture(name), context("tubabike-barcelos", "pt"));
      const stations = result.products.find((product) => product.productKey === "stations");
      return (stations?.records ?? []).map((record) => prepareRecord(record).hash);
    };
    const before = hashes("tubabike-barcelos-status");

    expect(before).toHaveLength(3);
    expect(hashes("tubabike-barcelos-status-restamped")).toEqual(before);
  });

  it("still revises a station whose counts really moved", () => {
    const result = transformer.transform(fixture("tubabike-barcelos-status"), context("tubabike-barcelos", "pt"));
    const station = result.products.find((product) => product.productKey === "stations")?.records?.[0];
    if (!station) throw new Error("The TubaBike status fixture must carry stations");
    const moved = { ...station, payload: { ...station.payload, numBikesAvailable: 99 } };

    expect(prepareRecord(moved).hash).not.toBe(prepareRecord(station).hash);
  });
});
