import { describe, expect, it } from "vitest";
import { readBoundedBytes } from "#/io/bytes";

function overflow(): Error {
  return new Error("body too large");
}

describe("bounded external byte reading", () => {
  it("returns at most the byte ceiling", async () => {
    const bytes = new TextEncoder().encode("bounded");
    expect(await readBoundedBytes(new Response(bytes).body!, String(bytes.byteLength), bytes.byteLength, overflow)).toEqual(bytes);
  });

  it("cancels before reading a declared overflow", async () => {
    let pulled = false;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulled = true;
        controller.enqueue(new Uint8Array(1));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readBoundedBytes(stream, "11", 10, overflow)).rejects.toThrow("body too large");
    expect(pulled).toBe(false);
    expect(cancelled).toBe(true);
  });

  it("cancels a streaming overflow without returning the overflowing chunk", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(6));
        controller.enqueue(new Uint8Array(5));
      },
      cancel() {
        cancelled = true;
      },
    });
    await expect(readBoundedBytes(stream, undefined, 10, overflow)).rejects.toThrow("body too large");
    expect(cancelled).toBe(true);
  });
});
