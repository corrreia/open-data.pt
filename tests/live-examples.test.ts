import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NORMALIZED_PROTOCOL,
  collectNormalized,
  resolveTopicFeed,
  topicCollector,
  type CollectionRequest,
  type ExampleFeed,
  type GatekeeperLibraries,
  type JsonObject,
  type ResolvedFeed,
  type TopicOptions,
} from "@open-data-pt/gatekeeper-shared";
import { isNormalizedFrame } from "../packages/gatekeeper-shared/src/normalized-validation";
import { readFrames } from "../apps/kernel/src/frames";
import { MAX_RECORD_BYTES } from "../apps/kernel/src/blob-budget";
import { jsonAs } from "./support";
import { PLANS, workerExamples, workerLibraries } from "./catalog";

/**
 * Collects curated examples from their real sources, the way the kernel
 * would, and reads the output through the kernel's own frame validation.
 * Opt-in because it calls public services: set LIVE_EXAMPLES to "all" or to
 * a comma-separated list of example slugs.
 */
const SELECTED =
  process.env.LIVE_EXAMPLES?.split(",")
    .map((slug) => slug.trim())
    .filter(Boolean) ?? [];
const MIB = 1024 * 1024;

/** The wiring the library Workers deploy, from the same generated plans and vars, with the real fetch. */
const WORKERS: Array<{ kind: string; libraries: GatekeeperLibraries; examples: readonly ExampleFeed[] }> = PLANS.map((plan) => ({
  kind: plan.name,
  libraries: workerLibraries(plan.name, { ML_CONSUMER_KEY: process.env.ML_CONSUMER_KEY, ML_CONSUMER_SECRET: process.env.ML_CONSUMER_SECRET }),
  examples: workerExamples(plan.name),
}));

/** The request the kernel builds for a live collection under this example's policy. */
function liveRequest(example: ExampleFeed, resolved: ResolvedFeed): CollectionRequest {
  const policy = example.policy.collection;
  const outputBytes = policy.maxOutputBytes ?? Math.max(MIB, Math.min(16 * MIB, policy.maxBytes * 4));
  const recordBytes = Math.min(policy.maxRecordBytes ?? 256 * 1024, MAX_RECORD_BYTES);
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: `live_${example.slug}`,
    feed: { id: "feed_live", slug: example.slug, title: example.title, description: example.description },
    resolved,
    feedEpoch: "live",
    mode: { kind: "live" },
    limits: {
      sourceBytes: policy.maxBytes,
      outputBytes,
      frameBytes: Math.min(outputBytes, recordBytes + 16 * 1024),
      recordBytes,
      records: policy.maxRecords ?? 1_000_000,
      products: 64,
    },
    deadline: new Date(Date.now() + policy.timeoutSeconds * 1000).toISOString(),
    observedAt: new Date().toISOString(),
  };
}

const cases = WORKERS.flatMap((worker) =>
  worker.examples
    .filter((example) => SELECTED.includes("all") || SELECTED.includes(example.slug))
    .map((example) => ({ slug: example.slug, example, options: { gatekeeperKind: worker.kind, libraries: worker.libraries } satisfies TopicOptions })),
);

describe.skipIf(cases.length === 0)("live examples", () => {
  it.each(cases)(
    "collects $slug",
    async ({ example, options }) => {
      const resolved = await resolveTopicFeed(example.config, options);
      const request = liveRequest(example, resolved);
      const result = await collectNormalized(request, topicCollector(resolved.config, options));
      if (result.kind !== "batch") throw new Error(`${example.slug} returned ${JSON.stringify(result)}`);
      const counts = new Map<string, number>();
      const scope = {
        collectionId: request.collectionId,
        resourceKey: resolved.resourceKey,
        configHash: resolved.configHash,
        feedEpoch: request.feedEpoch,
        mode: request.mode,
        deadline: request.deadline,
      };
      // Buffer the output (at most 16 MiB) so a rejected frame can be shown, not only counted.
      const text = await new Response(result.stream).text();
      const rejected = text.split("\n").find((line) => line !== "" && !isNormalizedFrame(jsonAs<JsonObject>(line)));
      if (rejected !== undefined) {
        const saved = join(tmpdir(), `live-rejected-${example.slug}.json`);
        writeFileSync(saved, rejected);
        throw new Error(`${example.slug} emitted an invalid frame, saved to ${saved}: ${rejected.slice(0, 500)}`);
      }
      for await (const frame of readFrames(new Response(text).body!, request.limits, scope)) {
        counts.set(frame.type, (counts.get(frame.type) ?? 0) + 1);
      }
      console.info(`${example.slug}: ${JSON.stringify(Object.fromEntries(counts))}`);
      expect(counts.get("header")).toBe(1);
      expect(counts.get("complete")).toBe(1);
      expect((counts.get("record") ?? 0) + (counts.get("point") ?? 0)).toBeGreaterThan(0);
    },
    300_000,
  );
});
