import { describe, expect, it } from "vitest";
import {
  assertCollectionResult,
  assertHistoryProgress,
  assertResolvedFeed,
  historyCursorKey,
  type CollectionResult,
  type JsonObject,
  type JsonValue,
  type NormalizedFrame,
  type ResolvedFeed,
} from "@open-data-pt/contract";
import { readFrames, type FrameLimits, type FrameScope } from "../src/frames";

import { checkpoint, scope, limits, header, framed } from "./normalized-fixtures";

/** Read a whole stream through the kernel's validator and return its completion frame. */
async function readNormalizedStream(stream: ReadableStream<Uint8Array>, frameLimits: FrameLimits, frameScope: FrameScope): Promise<Extract<NormalizedFrame, { type: "complete" }>> {
  let completion: Extract<NormalizedFrame, { type: "complete" }> | undefined;
  for await (const frame of readFrames(stream, frameLimits, frameScope)) if (frame.type === "complete") completion = frame;
  if (!completion) throw new Error("no completion");
  return completion;
}

describe("history cursor time bounds", () => {
  const current = { before: "2026-09-09T00:00:00.000Z", token: "page-a" };

  it("rejects a forward time bound even when an opaque token changes", async () => {
    const next = { before: "2026-09-10T00:00:00.000Z", token: "page-b" };
    expect(() => assertHistoryProgress(current, next, false)).toThrow("time bound");
    await expect(readNormalizedStream(framed([header()], { nextCursor: next }), limits, { ...scope, mode: { kind: "history", cursor: current } })).rejects.toThrow("time bound");
  });

  it("allows a changed opaque token at the same bound without inventing token ordering", () => {
    expect(() => assertHistoryProgress(current, { ...current, token: "page-0" }, false)).not.toThrow();
  });

  it("allows a backwards time bound with an opaque token", () => {
    expect(() => assertHistoryProgress(current, { before: "2026-09-08T00:00:00.000Z", token: "page-b" }, false)).not.toThrow();
  });

  it("still requires increasing offsets for tokenless same-bound continuation", () => {
    const offset = { before: current.before, offset: 2 };
    expect(() => assertHistoryProgress(offset, { ...offset, offset: 3 }, false)).not.toThrow();
    expect(() => assertHistoryProgress(offset, { ...offset, offset: 1 }, false)).toThrow();
    expect(() => assertHistoryProgress(offset, { before: offset.before }, false)).toThrow();
  });

  it("continues to reject exact repetition and previously visited opaque cursors", () => {
    expect(() => assertHistoryProgress(current, current, false)).toThrow("repeated or cycled");
    const visited = { ...current, token: "page-b" };
    expect(() => assertHistoryProgress(current, visited, false, [historyCursorKey(visited)])).toThrow("repeated or cycled");
  });
});

describe("resolved feed validation", () => {
  const valid: ResolvedFeed = {
    config: { feed: "events" },
    configHash: "a".repeat(64),
    resourceKey: "fixture:events:resource",
    kind: "events",
    semantics: { domainSubject: "event", defaultProductRole: "event-log" },
  };
  it("accepts the exact bounded descriptor", () => expect(() => assertResolvedFeed(valid)).not.toThrow());
  it.each([
    { ...valid, configHash: "not-a-digest" },
    { ...valid, config: { feed: "events", nested: {} } },
    { ...valid, extra: true },
    { ...valid, semantics: { ...valid.semantics, domainSubject: "sometimes" } },
    { ...valid, history: { earliest: "yesterday" } },
  ])("rejects malformed descriptor %j", (value) => {
    const untrusted: unknown = value;
    // SAFETY: the descriptor arrives over RPC typed as a ResolvedFeed; the validator is what finds it is not one.
    expect(() => assertResolvedFeed(untrusted as ResolvedFeed)).toThrow();
  });
});

describe("collection result envelope validation", () => {
  it("accepts only exact mode-compatible result envelopes", () => {
    const live = { kind: "live" } as const;
    const history = { kind: "history", cursor: { before: "2026-09-10T00:00:00.000Z" } } as const;
    expect(() => assertCollectionResult({ kind: "unchanged", checkpoint: checkpoint() }, live)).not.toThrow();
    expect(() => assertCollectionResult({ kind: "unchanged", checkpoint: checkpoint() }, history)).toThrow();
    expect(() => assertCollectionResult({ kind: "exhausted" }, history)).not.toThrow();
    expect(() => assertCollectionResult({ kind: "exhausted" }, live)).toThrow();
    expect(() => assertCollectionResult({ kind: "failure", code: "upstream-error", retryable: true, retryAfterSeconds: 30 }, live)).not.toThrow();
  });

  it.each([
    { kind: "batch", stream: "not-a-stream" },
    { kind: "failure", code: "invented", retryable: true },
    { kind: "failure", code: "upstream-error", retryable: "yes" },
    { kind: "failure", code: "upstream-error", retryable: true, retryAfterSeconds: -1 },
    { kind: "unchanged", checkpoint: checkpoint(), extra: true },
    { kind: "exhausted", checkpoint: checkpoint() },
  ])("rejects malformed or extended RPC result %j", (result) => {
    const untrusted: unknown = result;
    // SAFETY: the result arrives over RPC typed as a CollectionResult; the validator is what finds it is not one.
    expect(() => assertCollectionResult(untrusted as CollectionResult, { kind: "live" })).toThrow();
  });
});

describe("normalized consumer validation", () => {
  it.each(["resourceKey", "configHash", "feedEpoch"])("rejects wrong checkpoint %s", async (field) => {
    const h = header();
    h.checkpoint = {
      version: 2,
      resourceKey: scope.resourceKey,
      configHash: scope.configHash,
      feedEpoch: scope.feedEpoch,
      normalizer: { id: "fixture", version: "1" },
      state: {},
      [field]: "wrong",
    };
    await expect(readNormalizedStream(framed([h]), limits, scope)).rejects.toThrow();
  });
  it.each<[string, JsonValue]>([
    ["schema", {}],
    ["schema", { fields: [{ id: "x", name: "x", type: "bogus", nullable: false }] }],
    ["updateMode", "replace"],
    ["role", "bogus"],
    ["suggestedSlug", "../other"],
    ["watermark", "2026-02-30T00:00:00Z"],
  ])("rejects malformed product %s", async (field, value) => {
    const h = header();
    h.products = [
      {
        productKey: "events",
        suggestedSlug: "events",
        title: "Events",
        description: "",
        role: "event-log",
        schema: { fields: [] },
        kind: "record",
        updateMode: "authoritative-snapshot",
        completeness: "complete",
        [field]: value,
      },
    ];
    await expect(readNormalizedStream(framed([h]), limits, scope)).rejects.toThrow();
  });
  it.each(["record", "series"])("rejects inline product rows under kind:%s rather than bypassing row budgets and completion counts", async (kind) => {
    for (const field of ["records", "points"]) {
      const h = header();
      const record = { entityKey: "inline", payload: { oversized: "x".repeat(200) } };
      const point = { seriesKey: "inline", eventTime: "2026-09-09T00:00:00Z", value: 1, unit: "MW", dimensions: { oversized: "x".repeat(200) } };
      h.products = [
        {
          productKey: "inline",
          suggestedSlug: "inline",
          title: "Inline",
          description: "",
          role: "time-series",
          schema: { fields: [] },
          kind,
          updateMode: "authoritative-snapshot",
          completeness: "complete",
          [field]: field === "records" ? [record, record] : [point, point],
        },
      ];
      // No row frames: framed() emits all-zero completion counts.
      await expect(readNormalizedStream(framed([h]), { ...limits, records: 1, recordBytes: 64 }, scope)).rejects.toThrow("invalid frame");
    }
  });
  it.each<JsonObject>([
    { operation: "replace" },
    { eventTime: "yesterday" },
    { validFrom: "2026-09-10T00:00:00Z", validTo: "2026-09-09T00:00:00Z" },
    { identity: { confidence: "stable" } },
  ])("rejects malformed or retired record fields %j", async (fields) => {
    await expect(
      readNormalizedStream(framed([header(), { type: "record", productKey: "events", value: { entityKey: "a", payload: {}, ...fields } }]), limits, scope),
    ).rejects.toThrow();
  });
  it("rejects row/product kind disagreement", async () => {
    await expect(
      readNormalizedStream(
        framed([header(), { type: "point", productKey: "events", value: { seriesKey: "a", eventTime: "2026-09-09T00:00:00Z", value: 1, unit: "MW", dimensions: {} } }]),
        limits,
        scope,
      ),
    ).rejects.toThrow();
  });
  it.each<JsonObject>([
    { nextCursor: { before: "invalid" } },
    { nextCursor: { before: "2026-09-09T00:00:00Z", offset: -1 } },
    { exhausted: "yes" },
    { nextCursor: { before: "2026-09-09T00:00:00Z" }, exhausted: true },
  ])("rejects malformed completion metadata %j", async (completion) => {
    await expect(readNormalizedStream(framed([header()], completion), limits, scope)).rejects.toThrow();
  });
  it("rejects oversized or malformed checkpoint metadata", async () => {
    for (const state of [{ nested: { value: "x".repeat(17000) } }, { tooDeep: Array.from({ length: 70 }).reduce<JsonObject>((value) => ({ value }), {}) }]) {
      const h = header();
      h.checkpoint = { version: 2, resourceKey: scope.resourceKey, configHash: scope.configHash, feedEpoch: scope.feedEpoch, normalizer: { id: "fixture", version: "1" }, state };
      await expect(readNormalizedStream(framed([h]), limits, scope)).rejects.toThrow();
    }
  });
});

it("rejects exact offset/token repetition and bounded opaque cursor cycles before acceptance", async () => {
  const cursor = { before: "2026-09-09T00:00:00.000Z", offset: 2, token: "opaque" };
  const history = { ...scope, mode: { kind: "history" as const, cursor } };
  await expect(readNormalizedStream(framed([header()], { nextCursor: cursor }), limits, history)).rejects.toThrow("repeated or cycled");
  await expect(
    readNormalizedStream(framed([header()], { nextCursor: { ...cursor, token: "previous" } }), limits, {
      ...history,
      visitedCursors: [JSON.stringify([cursor.before, 2, "previous"])],
    }),
  ).rejects.toThrow("repeated or cycled");
  await expect(readNormalizedStream(framed([header()]), limits, history)).rejects.toThrow("explicit continuation or exhaustion");
  const accepted = await readNormalizedStream(framed([header()], { nextCursor: { ...cursor, offset: 3 } }), limits, history);
  expect(accepted.nextCursor?.offset).toBe(3);
});

it("rejects duplicate product keys and negative completion counts", async () => {
  const h = header();
  const duplicate = {
    productKey: "duplicate",
    suggestedSlug: "duplicate",
    title: "Duplicate",
    description: "",
    role: "reference",
    schema: { fields: [] },
    kind: "record",
    updateMode: "delta",
    completeness: "complete",
  };
  h.products = [duplicate, duplicate];
  await expect(readNormalizedStream(framed([h]), limits, scope)).rejects.toThrow("Duplicate product key");
  await expect(readNormalizedStream(framed([header()], { counts: { records: -1, points: 0 } }), limits, scope)).rejects.toThrow("invalid frame");
});
