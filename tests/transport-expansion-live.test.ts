import { describe, expect, it } from "vitest";
import { collectNormalized, NORMALIZED_PROTOCOL, type CollectionRequest, type ExampleFeed } from "@open-data-pt/gatekeeper";
import { readFrames } from "../apps/kernel/src/frames";
import { feedCollection, feedsOf } from "./catalog";

const GTFS_SLUGS = new Set(["cp-gtfs-feed", "fertagus-gtfs-feed", "tub-braga-gtfs-feed", "tcb-barreiro-gtfs-feed", "horarios-do-funchal-gtfs-feed"]);
const BIRD_SLUGS = new Set(["bird-porto", "bird-cascais", "bird-matosinhos"]);
const examples = [
  ...feedsOf("gtfs").filter((example) => GTFS_SLUGS.has(example.slug)),
  ...feedsOf("gbfs").filter((example) => BIRD_SLUGS.has(example.slug)),
  ...feedsOf("ckan").filter((example) => example.slug.startsWith("agueda-") || example.slug === "oeiras-hourly-environment-feed"),
];
const selected =
  process.env.LIVE_TRANSPORT_EXPANSION?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];

/** A standalone library smoke test before the orchestrator wires topic allowlists. */
describe.skipIf(selected.length === 0)("live transport and municipal expansion", () => {
  it.each(examples.filter((example) => selected.includes("all") || selected.includes(example.slug)))(
    "collects $slug within its actual policy",
    async (example) => {
      let sourceBytes = 0;
      const fetcher: typeof fetch = async (input, init) => {
        const response = await fetch(input, init);
        if (!response.body) return response;
        return new Response(
          response.body.pipeThrough(
            new TransformStream<Uint8Array, Uint8Array>({
              transform(chunk, controller) {
                sourceBytes += chunk.byteLength;
                controller.enqueue(chunk);
              },
            }),
          ),
          { status: response.status, headers: response.headers },
        );
      };
      const { resolved, collector } = await feedCollection(example.slug, { fetcher });
      const request = requestFor(example, resolved);
      const result = await collectNormalized(request, collector);
      if (result.kind !== "batch") throw new Error(JSON.stringify(result));
      const counts = new Map<string, number>();
      const clocks: string[] = [];
      let outputBytes = 0;
      let maximumFrame = 0;
      const stream = result.stream.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            outputBytes += chunk.byteLength;
            maximumFrame = Math.max(maximumFrame, chunk.byteLength);
            controller.enqueue(chunk);
          },
        }),
      );
      for await (const frame of readFrames(stream, request.limits, {
        collectionId: request.collectionId,
        resourceKey: resolved.resourceKey,
        configHash: resolved.configHash,
        feedEpoch: request.feedEpoch,
        mode: request.mode,
        deadline: request.deadline,
      })) {
        counts.set(frame.type, (counts.get(frame.type) ?? 0) + 1);
        if (frame.type === "record" || frame.type === "point") {
          counts.set(frame.productKey, (counts.get(frame.productKey) ?? 0) + 1);
          if (frame.value.eventTime) clocks.push(frame.value.eventTime);
        }
        if (frame.type === "complete") {
          expect(frame.quality.rejectedRecords).toBe(0);
          expect(frame.products?.filter((product) => product.completeness === "unknown") ?? []).toEqual([]);
        }
      }
      clocks.sort();
      console.info(
        JSON.stringify({ slug: example.slug, sourceBytes, outputBytes, maximumFrame, counts: Object.fromEntries(counts), firstTime: clocks[0], lastTime: clocks.at(-1) }),
      );
      expect(counts.get("complete")).toBe(1);
      expect((counts.get("record") ?? 0) + (counts.get("point") ?? 0)).toBeGreaterThan(0);
    },
    240_000,
  );
});

function requestFor(example: ExampleFeed, resolved: CollectionRequest["resolved"]): CollectionRequest {
  const policy = example.policy.collection;
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: `live_${example.slug}`,
    feed: { id: "fixture", slug: example.slug, title: example.title, description: example.description },
    resolved,
    feedEpoch: "live",
    observedAt: new Date().toISOString(),
    mode: { kind: "live" },
    deadline: new Date(Date.now() + policy.timeoutSeconds * 1000).toISOString(),
    limits: {
      sourceBytes: policy.maxBytes,
      outputBytes: policy.maxOutputBytes ?? 16 * 1024 * 1024,
      records: policy.maxRecords ?? 1_000_000,
      recordBytes: policy.maxRecordBytes ?? 256 * 1024,
      frameBytes: (policy.maxRecordBytes ?? 256 * 1024) + 16 * 1024,
      products: 64,
    },
  };
}
