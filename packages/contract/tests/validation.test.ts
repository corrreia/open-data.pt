import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { assertCollectionResult, type JsonValue } from "@open-data-pt/contract";

function foreignJson(expression: string): JsonValue {
  // SAFETY: each caller supplies a closed JSON-compatible literal whose value is deliberately created in a separate V8 context.
  return runInNewContext(expression) as JsonValue;
}

describe("collection result realm boundary", () => {
  const history = { kind: "history", cursor: { before: "2026-09-10T00:00:00.000Z" } } as const;

  it("accepts an exhausted envelope from a foreign realm", () => {
    const result = foreignJson('({ kind: "exhausted" })');
    expect(result).not.toBeInstanceOf(Object);
    expect(() => assertCollectionResult(result, history)).not.toThrow();
  });

  it.each([
    ["array", "[]"],
    ["number", "7"],
    ["string", '"exhausted"'],
    ["null", "null"],
    ["unknown kind", '({ kind: "invented" })'],
  ])("rejects a foreign-realm %s", (_, expression) => {
    expect(() => assertCollectionResult(foreignJson(expression), history)).toThrow("Gatekeeper returned an invalid collection result");
  });
});
