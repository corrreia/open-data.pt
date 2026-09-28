import { describe, expect, it } from "vitest";
import { NORMALIZED_PROTOCOL, type CollectionRequest, type CollectionResult } from "@open-data-pt/contract";
import { PLACED_COLLECTION_PATH, collectionOf, placedRequest, placedResponse, placedResult } from "#/placed";

const REQUEST: CollectionRequest = {
  protocol: NORMALIZED_PROTOCOL,
  slug: "snirh-precipitation-feed",
  configHash: "0".repeat(64),
  mode: { kind: "live" },
  limits: { sourceBytes: 1024, outputBytes: 4096, recordBytes: 1024, records: 10 },
  deadline: "2026-09-28T00:10:00.000Z",
  observedAt: "2026-09-28T00:00:00.000Z",
};

/** A result sent through the placed handler and read back, as `collect` hands it to the kernel. */
async function roundTrip(result: CollectionResult): Promise<CollectionResult> {
  return placedResult(placedResponse(result));
}

describe("a collection run in the placed fetch handler", () => {
  it("asks for the collection it was given, on the one path the handler answers", async () => {
    const request = placedRequest(REQUEST);
    expect(request.method).toBe("POST");
    expect(new URL(request.url).pathname).toBe(PLACED_COLLECTION_PATH);
    expect(await collectionOf(request)).toEqual(REQUEST);
  });

  it("streams a batch back as it came", async () => {
    const stream = new Response('{"type":"header"}\n{"type":"complete"}\n').body!;
    const result = await roundTrip({ kind: "batch", stream });
    if (result.kind !== "batch") throw new Error(`Expected a batch, got ${result.kind}`);
    expect(await new Response(result.stream).text()).toBe('{"type":"header"}\n{"type":"complete"}\n');
  });

  it.each<CollectionResult>([
    { kind: "failure", code: "upstream-error", retryable: true, retryAfterSeconds: 120 },
    { kind: "failure", code: "source-denied", retryable: false },
    { kind: "unchanged", checkpoint: { normalizer: { id: "snirh", version: "1" }, state: { validators: {} } } },
    { kind: "exhausted" },
  ])("hands back a %j result unchanged", async (result) => {
    expect(await roundTrip(result)).toEqual(result);
  });

  it("refuses an answer that carries no result, so the caller reports a failure instead of guessing", async () => {
    await expect(placedResult(new Response("Not found", { status: 404 }))).rejects.toThrow(/HTTP 404 without a result/);
  });
});
