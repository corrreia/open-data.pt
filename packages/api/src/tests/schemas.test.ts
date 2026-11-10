import { describe, expect, it } from "vitest";

import { AcquisitionSchema, FeedSchema, HistoryPageSchema, LakeChangeSchema, ProblemSchema, ProductSchema } from "../index";

const time = "2026-09-10T12:00:00.000Z";

describe("public runtime schemas", () => {
  it("validates representative product, feed and acquisition responses", () => {
    expect(
      ProductSchema.parse({
        id: "prd_1",
        slug: "places",
        feedId: "feed_1",
        title: "Places",
        description: "One row per place.",
        role: "reference",
        schema: { fields: [{ id: "name", name: "name", type: "string", nullable: false }] },
        version: 3,
        status: "current",
        currentAcquisitionId: "acq_1",
        watermark: null,
        rowCount: 1,
        completeness: "complete",
        stale: false,
        staleAfterSeconds: 3600,
        cadenceSeconds: 900,
        historyMode: "changes",
        exposeHistory: true,
        licence: { id: "cc-by-4.0", name: "CC BY 4.0" },
        attribution: "Publisher",
        hasChanges: true,
        hasSeries: false,
        updatedAt: time,
      }),
    ).toMatchObject({ slug: "places", rowCount: 1 });

    expect(
      FeedSchema.parse({
        id: "feed_1",
        slug: "places-feed",
        title: "Places",
        description: "Places feed.",
        publisher: { id: "publisher", name: "Publisher" },
        licence: { id: "cc-by-4.0", name: "CC BY 4.0" },
        topics: ["cities"],
        format: "ogc",
        cadenceSeconds: 900,
        enabled: true,
        staleAfterSeconds: 3600,
        createdAt: time,
        updatedAt: time,
      }),
    ).toMatchObject({ format: "ogc" });

    expect(AcquisitionSchema.parse({ id: "acq_1", feedId: "feed_1", trigger: "schedule", status: "succeeded", requestedAt: time, rows: 1 })).toMatchObject({
      status: "succeeded",
    });
  });

  it("validates a representative history page and problem response", () => {
    const page = HistoryPageSchema(LakeChangeSchema).parse({
      data: [
        {
          revisionId: "rev_1",
          entityKey: "place_1",
          operation: "upsert",
          eventTime: null,
          validFrom: null,
          validTo: null,
          sourcePublishedAt: null,
          sourceSequence: null,
          observedAt: time,
          ingestedAt: time,
          payload: { name: "Lisboa" },
        },
      ],
      nextCursor: null,
      freshness: { updatedAt: time, stale: false },
      coverage: { requested: { from: time, to: "2026-09-11T12:00:00.000Z" }, lakeStartsAt: time, coveredFrom: time, complete: true, reason: null },
      source: "lake",
    });
    expect(page.data).toHaveLength(1);
    expect(ProblemSchema.parse({ type: "about:blank", title: "Storage unavailable", status: 503, detail: "Retry shortly." })).toMatchObject({ status: 503 });
  });

  it("rejects contract drift", () => {
    expect(() => FeedSchema.parse({ format: "" })).toThrow();
    expect(() => ProblemSchema.parse({ type: "about:blank", title: "Bad", status: "503", detail: "Bad" })).toThrow();
  });
});
