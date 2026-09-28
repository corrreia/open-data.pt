import { describe, expect, it } from "vitest";
import { definitionFingerprint, feedDefinition, type Feed, type FeedStatus } from "#/registry/feed-model";

const DEFINITION: Feed = {
  id: "feed_1",
  slug: "things",
  title: "Things",
  description: "Fixture",
  library: "fixture",
  resourceKey: "fixture:fixture:things:1",
  configHash: "0".repeat(64),
  eventTimed: false,
  policy: { cadenceSeconds: 3600, timeoutSeconds: 30, maxBytes: 1024, historyMode: "changes" },
  feedEpoch: "epoch",
  enabled: true,
  staleAfterSeconds: 7200,
  publisher: "ine",
  licence: "cc-by-4.0",
  topics: ["economy"],
  createdAt: "2026-09-10T00:00:00.000Z",
  updatedAt: "2026-09-10T00:00:00.000Z",
};

/** Every field a runner reports: `Required` makes this list grow with FeedStatus, so a new field cannot be missed. */
const STATUS: Required<FeedStatus> = {
  cooldownUntil: "2026-09-27T06:00:00.000Z",
  checkpoint: { normalizer: { id: "fixture", version: "1" }, state: {} },
  backfill: {
    status: "running",
    cursor: "2026-09-01T00:00:00.000Z",
    until: "2020-01-01T00:00:00.000Z",
    slices: 1,
    points: 1,
    records: 1,
    failures: 0,
    floors: {},
    startedAt: "2026-09-26T00:00:00.000Z",
    updatedAt: "2026-09-27T00:00:00.000Z",
    lastError: "none",
  },
  nextRunAt: "2026-09-27T01:00:00.000Z",
  lastAttemptAt: "2026-09-27T00:00:00.000Z",
  lastSuccessAt: "2026-09-27T00:00:00.000Z",
  lastAcquisitionStatus: "succeeded",
  lastError: "none",
  consecutiveFailures: 0,
  running: false,
  historyBacklog: 0,
  sourceUrl: "https://example.test/things",
};

describe("a feed's definition", () => {
  it("leaves out everything its runner reports, so a feed read with its status is the same definition", () => {
    const withStatus: Feed = { ...DEFINITION, ...STATUS };
    const definition = feedDefinition(withStatus);
    for (const field of Object.keys(STATUS)) expect(definition, field).not.toHaveProperty(field);
    // The Registry reads a feed with its status and compares it with the catalog's: the same feed must not look changed.
    expect(definitionFingerprint(withStatus)).toBe(definitionFingerprint(DEFINITION));
  });
});
