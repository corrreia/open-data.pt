import { describe, expect, it } from "vitest";
import { feedCollection, feedsOf } from "#/tests/catalog";
import { NORMALIZED_PROTOCOL, collectNormalized, isJsonObject, parseJson, type CollectionRequest, type JsonObject } from "#/index";

const wanted = (process.env.LIVE_OGC ?? "")
  .split(",")
  .map((slug) => slug.trim())
  .filter(Boolean);

async function readFrames(stream: ReadableStream<Uint8Array>): Promise<JsonObject[]> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    text += decoder.decode(part.value, { stream: true });
  }
  return text
    .trim()
    .split("\n")
    .map((line) => {
      const frame = parseJson(line);
      if (!isJsonObject(frame)) throw new Error("frame");
      return frame;
    });
}

describe.runIf(wanted.length > 0)("OGC live collection", () => {
  const chosen = feedsOf("ogc").filter((example) => wanted.includes(example.slug));
  it.each(chosen)(
    "collects $slug from its real service",
    async (example) => {
      const { resolved, collector } = await feedCollection(example.slug, { fetcher: (input, init) => fetch(input, init) });
      const request: CollectionRequest = {
        protocol: NORMALIZED_PROTOCOL,
        slug: example.slug,
        configHash: resolved.configHash,
        mode: { kind: "live" },
        limits: {
          sourceBytes: example.policy.maxBytes,
          outputBytes: example.policy.maxOutputBytes ?? Math.max(1024 * 1024, Math.min(16 * 1024 * 1024, example.policy.maxBytes * 4)),
          recordBytes: example.policy.maxRecordBytes ?? 262_144,
          records: example.policy.maxRecords ?? 1_000_000,
        },
        deadline: new Date(Date.now() + example.policy.timeoutSeconds * 1000).toISOString(),
        observedAt: new Date().toISOString(),
      };
      const result = await collectNormalized(request, collector);
      if (result.kind !== "batch") throw new Error(`${example.slug}: ${JSON.stringify(result)}`);
      const frames = await readFrames(result.stream);
      const header = frames[0];
      const complete = frames.at(-1);
      const records = frames.filter((frame) => frame.type === "record").length;
      console.log(
        JSON.stringify({
          slug: example.slug,
          completeness: Array.isArray(header?.products) && isJsonObject(header.products[0]) ? header.products[0].completeness : undefined,
          records,
          quality: complete?.quality,
          finalCompleteness: Array.isArray(complete?.products) && isJsonObject(complete.products[0]) ? complete.products[0].completeness : undefined,
          bytes: frames.reduce((total, frame) => total + JSON.stringify(frame).length, 0),
          maxFrame: Math.max(...frames.map((frame) => JSON.stringify(frame).length)),
        }),
      );
      expect(header?.type).toBe("header");
      expect(complete?.type).toBe("complete");
      expect(records).toBeGreaterThan(0);
    },
    300_000,
  );
});
