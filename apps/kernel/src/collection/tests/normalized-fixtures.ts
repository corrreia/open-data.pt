import type { JsonObject, SourceCheckpoint } from "@open-data-pt/contract";

export const scope = {
  mode: { kind: "live" as const },
  deadline: new Date(Date.now() + 60_000).toISOString(),
};
export const limits = { outputBytes: 32_768, recordBytes: 1024, records: 10 };

/** The checkpoint a fixture header carries: the fixture normalizer, and no state of the source's own. */
export function checkpoint(): SourceCheckpoint {
  return { normalizer: { id: "fixture", version: "1" }, state: {} };
}

export function header(): JsonObject {
  return {
    type: "header",
    products: [
      {
        productKey: "events",
        slug: "events",
        title: "Events",
        description: "",
        role: "event-log",
        schema: { fields: [{ id: "x", name: "X", type: "number", nullable: false }] },
        kind: "record",
        updateMode: "authoritative-snapshot",
        completeness: "complete",
      },
    ],
    provenance: { sourceUrl: "https://example.test/data" },
    checkpoint: { ...checkpoint() },
  };
}

/** NDJSON text of the frames followed by a matching completion frame. */
export function framedText(frames: JsonObject[], completion: JsonObject = {}): string {
  const counts = { records: frames.filter((frame) => frame.type === "record").length, points: frames.filter((frame) => frame.type === "point").length };
  const text = frames.map((frame) => `${JSON.stringify(frame)}\n`).join("");
  return `${text}${JSON.stringify({ type: "complete", quality: { acceptedRecords: counts.records + counts.points, rejectedRecords: 0 }, ...completion })}\n`;
}

export function framed(frames: JsonObject[], completion: JsonObject = {}): ReadableStream<Uint8Array> {
  return new Response(framedText(frames, completion)).body!;
}

/** A byte stream cut into pieces of `size` bytes, including inside multi-byte characters. */
export function chunked(text: string | Uint8Array, size: number): ReadableStream<Uint8Array> {
  const bytes = text instanceof Uint8Array ? text : new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}
