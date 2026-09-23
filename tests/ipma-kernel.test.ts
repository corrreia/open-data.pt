import { describe, expect, it } from "vitest";
import type { CanonicalRecord, TransformContext } from "@open-data-pt/contract";
import { prepareRecord } from "../apps/kernel/src/records";
import { IpmaTransformer } from "../apps/gatekeeper/src/publishers/ipma/ipma/transform";
import { readFixtureBytes } from "../apps/gatekeeper/tests/support";

type FeedKind = "daily-forecast" | "sea-forecast";

/** The IPMA library's own fixtures, read from beside its tests. */
function fixture(name: FeedKind): Uint8Array {
  return readFixtureBytes(new URL(`../apps/gatekeeper/src/publishers/ipma/ipma/tests/fixtures/${name}.json`, import.meta.url));
}

function restated(name: FeedKind, from: string, to: string): Uint8Array {
  return new TextEncoder().encode(new TextDecoder().decode(fixture(name)).replaceAll(from, to));
}

function context(kind: FeedKind, observedAt: string): TransformContext {
  return {
    feed: {
      slug: `ipma-${kind}-feed`,
      title: kind,
      description: "test feed",
      config: { feed: kind },
      semantics: {
        domainSubject: kind === "daily-forecast" ? "reference" : "observation",
        defaultProductRole: "reference",
      },
    },
    observedAt,
  };
}

/** The hash the kernel stores each record under: an unchanged record must keep it. */
const hashes = (records: CanonicalRecord[] | undefined): string[] => (records ?? []).map((record) => prepareRecord(record).hash);

describe("IPMA records under the kernel's hash", () => {
  const transformer = new IpmaTransformer();

  it("gives an unchanged forecast the same semantic hash after IPMA restates the document hour", async () => {
    const first = await transformer.transform(fixture("daily-forecast"), context("daily-forecast", "2026-09-07T17:35:04.000Z"));
    // The same forecasts an hour later: IPMA rebuilt the document, so every dataUpdate moved on.
    const second = await transformer.transform(
      restated("daily-forecast", '"dataUpdate": "2026-09-07T16:31:03"', '"dataUpdate": "2026-09-07T17:31:07"'),
      context("daily-forecast", "2026-09-07T17:35:04.000Z"),
    );

    expect(hashes(first.products[0]?.records)).toHaveLength(6);
    expect(hashes(second.products[0]?.records)).toEqual(hashes(first.products[0]?.records));
    expect(first.products[0]?.records?.every((record) => record.sourcePublishedAt === undefined)).toBe(true);
  });

  it("gives an unchanged sea forecast the same semantic hash after IPMA restates the document hour", async () => {
    const first = await transformer.transform(fixture("sea-forecast"), context("sea-forecast", "2026-09-07T20:55:55.000Z"));
    const second = await transformer.transform(
      restated("sea-forecast", '"dataUpdate": "2026-09-07T20:31:01"', '"dataUpdate": "2026-09-07T21:31:04"'),
      context("sea-forecast", "2026-09-07T20:55:55.000Z"),
    );

    expect(hashes(first.products[0]?.records)).toHaveLength(6);
    expect(hashes(second.products[0]?.records)).toEqual(hashes(first.products[0]?.records));
  });
});
