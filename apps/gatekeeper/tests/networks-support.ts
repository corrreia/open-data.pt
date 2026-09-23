import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  NORMALIZED_PROTOCOL,
  isJsonObject,
  isNormalizedFrame,
  parseJson,
  type CollectionRequest,
  type CollectionResult,
  type JsonObject,
  type JsonValue,
  type NormalizedCollector,
  type NormalizedFrame,
  type NormalizedRow,
  type SourceConfig,
  type StreamingTransform,
  type TransformContext,
} from "#/index";

/** A saved response, by its URL beside the test that reads it: `networkFixture(new URL("./fixtures/probes.json", import.meta.url))`. */
export function networkFixture(url: URL): JsonObject {
  const value = parseJson(readFileSync(fileURLToPath(url.href), "utf8"));
  if (!isJsonObject(value)) throw new Error("Invalid synthetic fixture");
  return value;
}

export function networkContext(config: SourceConfig, observedAt = "2026-09-16T12:00:00Z"): TransformContext {
  return {
    feed: {
      slug: "network-test-feed",
      title: "Synthetic network test",
      description: "Synthetic public infrastructure test",
      config,
      semantics: { domainSubject: "observation", defaultProductRole: "current-state" },
    },
    observedAt,
  };
}

export function networkBytes(value: JsonObject, size = 1): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      controller.enqueue(bytes.slice(offset, offset + size));
      offset += size;
    },
  });
}

export async function networkRows(transform: StreamingTransform) {
  const rows: NormalizedRow[] = [];
  for await (const row of transform.rows) rows.push(row);
  return { products: transform.products, rows, summary: transform.finish() };
}

export async function networkRequest(collector: NormalizedCollector, config: SourceConfig): Promise<CollectionRequest> {
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: "network-test",
    feed: { id: "network-test", slug: "network-test-feed", title: "Network test", description: "Synthetic network test" },
    resolved: await collector.resolve(config),
    feedEpoch: "network-test",
    mode: { kind: "live" },
    observedAt: "2026-09-16T12:00:00Z",
    deadline: new Date(Date.now() + 60_000).toISOString(),
    limits: { sourceBytes: 1024 * 1024, outputBytes: 2 * 1024 * 1024, frameBytes: 128 * 1024, recordBytes: 16 * 1024, records: 5000, products: 4 },
  };
}

export async function networkFrames(result: CollectionResult): Promise<NormalizedFrame[]> {
  if (result.kind !== "batch") throw new Error(JSON.stringify(result));
  return (await new Response(result.stream).text())
    .trim()
    .split("\n")
    .map((line) => {
      const frame = parseJson(line);
      if (!isJsonObject(frame) || !isNormalizedFrame(frame)) throw new Error("Invalid normalized frame");
      const untrusted: unknown = frame;
      // SAFETY: isNormalizedFrame checked the discriminant and every field of this frame variant, as the kernel's reader does.
      return untrusted as NormalizedFrame;
    });
}

export function object(value: JsonValue | undefined): JsonObject {
  if (!isJsonObject(value)) throw new Error("Expected object");
  return value;
}
