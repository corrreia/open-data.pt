import { describe, expect, it } from "vitest";
import { NormalizedInputError, isPermanentCollectionError } from "@open-data-pt/gatekeeper-shared";

describe("normalized error RPC classification", () => {
  it("recognizes only the complete serialized envelope or local class", () => {
    const local = new NormalizedInputError("invalid frame");
    expect(isPermanentCollectionError(local)).toBe(true);
    expect(isPermanentCollectionError(new Error(local.message))).toBe(true);
    for (const message of [
      `prefix ${local.message}`,
      `${local.message} suffix`,
      `wrapped: ${local.message}`,
      "temporary upstream wrapper: Normalized contract rejected: retry later",
      "Normalized contract rejected: old unmarked prose",
    ]) {
      expect(isPermanentCollectionError(new Error(message)), message).toBe(false);
    }
  });
});
