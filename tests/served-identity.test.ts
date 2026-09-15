import { describe, expect, it } from "vitest";
import { servedIdentity } from "../apps/kernel/src/chunks";
import { prepareRecord, servingJson, type RecordContext } from "../apps/kernel/src/records";

const context: RecordContext = {
  feedId: "feed_1", acquisitionId: "acq_1", slug: "things", productVersion: 1, observedAt: "2026-09-12T00:00:00.000Z",
  normalizer: { id: "fixture", version: "1" }, baseline: false, keepHistory: false,
};

describe("served row identity", () => {
  it("reads a row's key and hash exactly as a full parse would, whatever its payload holds", () => {
    const payloads = [
      {},
      { name: "plain", value: 1 },
      { id: "overridden", _hash: "forged", _time: { event: "x" } },
      { nested: { id: "inner", _hash: "inner-hash", list: [{ id: 1, _hash: "deeper" }] } },
      { "a\"id": "a quote in a key", "x\":\"_hash\":\"": "the markers in a key" },
      { text: "\"id\":\"fake\",\"_hash\":\"fake\"", 0: "an integer-like key, which JSON writes first", "ã😀": "unicode" },
    ];
    const keys = ["k1", "a key with \"quotes\"", "ã😀", "a,\"_hash\":\"b", "\"id\":"];
    for (const payload of payloads) {
      for (const key of keys) {
        const json = servingJson(prepareRecord({ entityKey: key, payload }), context);
        // SAFETY: servingJson always writes an object with a string `id` and a string `_hash`.
        const parsed = JSON.parse(json) as { id: string; _hash: string };
        expect(servedIdentity(json)).toEqual({ key: parsed.id, hash: parsed._hash });
      }
    }
  });

  it("falls back to a full parse for a row in any other layout", () => {
    expect(servedIdentity(JSON.stringify({ _hash: "h", id: "k", value: 1 }))).toEqual({ key: "k", hash: "h" });
  });
});
