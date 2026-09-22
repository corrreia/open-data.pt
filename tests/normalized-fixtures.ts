import { NORMALIZED_PROTOCOL, type JsonObject } from "@open-data-pt/contract";

export const scope = {
  collectionId: "batch_1",
  resourceKey: "fixture:events:config-v1",
  configHash: "config-v1",
  feedEpoch: "epoch-1",
  mode: { kind: "live" as const },
  deadline: new Date(Date.now() + 60_000).toISOString(),
};
export const limits = { outputBytes: 32_768, frameBytes: 8192, recordBytes: 1024, records: 10, products: 4 };

export function header(): JsonObject {
  return {
    type: "header",
    protocol: NORMALIZED_PROTOCOL,
    collectionId: scope.collectionId,
    normalizer: { id: "fixture", version: "1" },
    products: [
      {
        productKey: "events",
        suggestedSlug: "events",
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
    completeness: "complete",
    checkpoint: { version: 2, resourceKey: scope.resourceKey, configHash: scope.configHash, feedEpoch: scope.feedEpoch, normalizer: { id: "fixture", version: "1" }, state: {} },
  };
}

/** NDJSON text of the frames followed by a matching completion frame. */
export function framedText(frames: JsonObject[], completion: JsonObject = {}): string {
  const counts = { records: frames.filter((frame) => frame.type === "record").length, points: frames.filter((frame) => frame.type === "point").length };
  const text = frames.map((frame) => `${JSON.stringify(frame)}\n`).join("");
  return `${text}${JSON.stringify({ type: "complete", counts, quality: { acceptedRecords: counts.records + counts.points, rejectedRecords: 0 }, ...completion })}\n`;
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
