import { readFixture, readFixtureBytes } from "#/tests/support";
import { describe, expect, it } from "vitest";
import type { TransformContext } from "@open-data-pt/contract";
import { AnepcTransformer } from "#/publishers/anepc/anepc/index";

const FIXTURE = new URL("./fixtures/active-occurrences.json", import.meta.url);

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

describe("ANEPC normalizer", () => {
  it("normalizes ANEPC accidents and fires under their public occurrence numbers", () => {
    const result = new AnepcTransformer().transform(readFixtureBytes(FIXTURE), context("anepc-active-occurrences-feed", { feed: "active-occurrences" }, "event", "event-log"));
    const records = result.products[0]?.records;
    expect(result.quality).toEqual({ acceptedRecords: 2, rejectedRecords: 0 });
    expect(result.products[0]).toMatchObject({ role: "event-log", updateMode: "authoritative-snapshot", watermark: "2026-09-18T17:12:00.000Z" });
    expect(records?.[0]).toMatchObject({
      entityKey: "20261330257",
      eventTime: "2026-09-18T17:07:00.000Z",
      payload: { natureCode: "2401", nature: "Atropelamento rodoviário", municipality: "Ponte de Lima", personnel: 2 },
    });
    expect(records?.[1]).toMatchObject({ entityKey: "20261330262", payload: { natureCode: "3103", classification: "Incêndios Rurais DECIR" } });
  });

  it("rejects an out-of-range epoch", () => {
    const result = new AnepcTransformer().transform(
      new TextEncoder().encode(readFixture(FIXTURE).replaceAll("1789751220000", "9007199254740991")),
      context("anepc-active-occurrences-feed", { feed: "active-occurrences" }, "event", "event-log"),
    );
    expect(result.quality).toEqual({ acceptedRecords: 1, rejectedRecords: 1 });
  });
});
