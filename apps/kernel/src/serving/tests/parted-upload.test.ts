import { describe, expect, it } from "vitest";
import { PartedUpload, type UploadTarget, type UploadedPart } from "#/serving/parted-upload";

/** What the bucket in memory received. */
interface Received {
  puts: Uint8Array[];
  parts: Uint8Array[];
  completed: boolean;
  aborted: boolean;
  begun: number;
}

/** R2's multipart rules, kept by a bucket in memory: every part but the last the same size. */
function bucket() {
  const state: Received = { puts: [], parts: [], completed: false, aborted: false, begun: 0 };
  const target: UploadTarget = {
    put: async (bytes) => void state.puts.push(bytes),
    begin: async () => {
      state.begun += 1;
      return {
        uploadPart: async (partNumber, bytes): Promise<UploadedPart> => {
          expect(partNumber).toBe(state.parts.length + 1);
          state.parts.push(bytes);
          return { partNumber, etag: `e${partNumber}` };
        },
        complete: async (parts) => {
          expect(parts.map((part) => part.partNumber)).toEqual(state.parts.map((_, index) => index + 1));
          const sizes = state.parts.slice(0, -1).map((part) => part.byteLength);
          expect(new Set(sizes).size).toBeLessThanOrEqual(1);
          state.completed = true;
        },
        abort: async () => {
          state.aborted = true;
        },
      };
    },
  };
  return { state, target };
}

const bytes = (length: number, fill = 1) => new Uint8Array(length).fill(fill);

describe("a file uploaded in pieces", () => {
  it("is stored with one write while it stays under one part", async () => {
    const { state, target } = bucket();
    const upload = new PartedUpload(target, 10);
    await upload.write(bytes(4));
    await upload.write(bytes(5, 2));
    expect(await upload.close()).toBe(9);
    expect(state.begun).toBe(0);
    expect(state.puts).toEqual([Uint8Array.from([1, 1, 1, 1, 2, 2, 2, 2, 2])]);
  });

  it("becomes a multipart upload of equal parts, whatever size its pieces are", async () => {
    const { state, target } = bucket();
    const upload = new PartedUpload(target, 10);
    for (const size of [3, 14, 1, 9, 6]) await upload.write(bytes(size));
    expect(await upload.close()).toBe(33);
    expect(state.puts).toEqual([]);
    expect(state.parts.map((part) => part.byteLength)).toEqual([10, 10, 10, 3]);
    expect(state.completed).toBe(true);
  });

  it("aborts the multipart upload it started", async () => {
    const { state, target } = bucket();
    const upload = new PartedUpload(target, 10);
    await upload.write(bytes(25));
    await upload.abort();
    expect(state.aborted).toBe(true);
    expect(state.completed).toBe(false);
  });
});
