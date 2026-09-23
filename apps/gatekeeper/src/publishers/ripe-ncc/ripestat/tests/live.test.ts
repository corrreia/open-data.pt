import { describe, expect, it } from "vitest";
import { collectNormalized } from "#/index";
import { networkFrames, networkRequest } from "#/tests/networks-support";
import { datasetOf, feedCollection, feedsOf } from "#/tests/catalog";

// Research-only opt-in: RIPEstat restricts republication. This check does not deploy or store source data.
const selected = (process.env.LIVE_NETWORKS ?? "").split(",");

describe("RIPEstat live research", () => {
  for (const example of feedsOf("ripestat")) {
    it.skipIf(!selected.includes(example.slug) && !selected.includes(example.config.source ?? ""))(
      example.slug,
      async () => {
        let requests = 0;
        let detail = "";
        const { resolved, collector: adapter } = await feedCollection(example.slug, {
          fetcher: async (input, init) => {
            requests += 1;
            try {
              const response = await fetch(input, init);
              if (!response.ok) detail = `HTTP ${response.status}`;
              return response;
            } catch (error) {
              detail = error instanceof Error ? `${error.message}; ${error.cause instanceof Error ? error.cause.message : String(error.cause)}` : String(error);
              throw error;
            }
          },
        });
        const request = await networkRequest(adapter, resolved.config);
        request.feed = {
          id: example.slug,
          slug: example.slug,
          title: example.title ?? datasetOf(example).title,
          description: example.description ?? datasetOf(example).description,
        };
        request.observedAt = new Date().toISOString();
        const result = await collectNormalized(request, adapter);
        if (result.kind !== "batch") throw new Error(`${JSON.stringify(result)} ${detail}`);
        const frames = await networkFrames(result);
        const complete = frames.at(-1);
        expect(complete?.type).toBe("complete");
        if (complete?.type !== "complete") throw new Error("No completion frame");
        expect(complete.quality.rejectedRecords).toBe(0);
        expect(complete.counts.records + complete.counts.points).toBeGreaterThan(0);
        expect(frames.filter((frame) => frame.type === "header")).toHaveLength(1);
        expect(requests).toBeLessThanOrEqual(1);
        console.log(
          JSON.stringify({
            slug: example.slug,
            requests,
            ...complete.counts,
            normalizedBytes: new TextEncoder().encode(frames.map((frame) => JSON.stringify(frame)).join("\n")).length,
          }),
        );
      },
      90_000,
    );
  }

  it.skipIf(!selected.includes("ripestat"))(
    "RIPEstat source-supported historical window",
    async () => {
      const example = feedsOf("ripestat").find((item) => item.config.feed === "country-routing")!;
      const { resolved, collector: adapter } = await feedCollection(example.slug, { fetcher: (input, init) => fetch(input, init) });
      const request = await networkRequest(adapter, resolved.config);
      const now = new Date();
      const before = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) - 30 * 86_400_000).toISOString();
      request.mode = { kind: "history", cursor: { before } };
      const frames = await networkFrames(await collectNormalized(request, adapter));
      const complete = frames.at(-1);
      if (complete?.type !== "complete") throw new Error("No history completion");
      expect(complete.counts.points).toBeGreaterThan(0);
      if (!complete.nextCursor) throw new Error("History slice omitted its older cursor");
      expect(complete.nextCursor.before < before).toBe(true);
      expect(complete.quality.rejectedRecords).toBe(0);
    },
    90_000,
  );
});
