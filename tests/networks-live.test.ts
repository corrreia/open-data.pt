import { describe, expect, it } from "vitest";
import { collectNormalized, libraryConfig, type ExampleFeed, type NormalizedCollector } from "../apps/gatekeeper/src/index";
import { RIPESTAT_EXAMPLES, ripestatCollector } from "../apps/gatekeeper/src/sources/ripestat";
import { PEERINGDB_EXAMPLES, peeringdbCollector } from "../apps/gatekeeper/src/sources/peeringdb";
import { IODA_EXAMPLES, IODA_HOST, iodaCollector } from "../apps/gatekeeper/src/sources/ioda";
import { RIPEATLAS_EXAMPLES, ripeatlasCollector } from "../apps/gatekeeper/src/sources/ripeatlas";
import { networkFrames, networkRequest } from "./networks-support";

// Research-only opt-in: each of these publishers restricts republication. These checks do not deploy or store source data.
const selected = (process.env.LIVE_NETWORKS ?? "").split(",");

function collector(example: ExampleFeed, fetcher: typeof fetch): NormalizedCollector {
  const config = libraryConfig(example.config);
  if (example.config.source === "ioda") return iodaCollector({ config, hosts: IODA_HOST, fetcher });
  if (example.config.source === "ripeatlas") return ripeatlasCollector({ config, apiOrigin: "https://atlas.ripe.net", fetcher });
  return example.config.source === "ripestat"
    ? ripestatCollector({ config, apiOrigin: "https://stat.ripe.net", fetcher })
    : peeringdbCollector({ config, apiOrigin: "https://www.peeringdb.com", fetcher });
}

describe("internet infrastructure live research", () => {
  for (const example of [...RIPESTAT_EXAMPLES, ...PEERINGDB_EXAMPLES, ...IODA_EXAMPLES, ...RIPEATLAS_EXAMPLES]) {
    it.skipIf(!selected.includes(example.slug) && !selected.includes(example.config.source ?? ""))(
      example.slug,
      async () => {
        let requests = 0;
        let detail = "";
        const adapter = collector(example, async (input, init) => {
          requests += 1;
          try {
            const response = await fetch(input, init);
            if (!response.ok) detail = `HTTP ${response.status}`;
            return response;
          } catch (error) {
            detail = error instanceof Error ? `${error.message}; ${error.cause instanceof Error ? error.cause.message : String(error.cause)}` : String(error);
            throw error;
          }
        });
        const request = await networkRequest(adapter, libraryConfig(example.config));
        request.feed = { id: example.slug, slug: example.slug, title: example.title, description: example.description };
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
        expect(requests).toBeLessThanOrEqual(example.config.source === "peeringdb" ? 11 : example.config.source === "ripeatlas" ? 4 : 1);
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
      const example = RIPESTAT_EXAMPLES.find((item) => item.config.feed === "country-routing")!;
      const adapter = collector(example, (input, init) => fetch(input, init));
      const request = await networkRequest(adapter, libraryConfig(example.config));
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
