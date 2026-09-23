import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  NORMALIZED_PROTOCOL,
  collectNormalized,
  feedCollector,
  resolveLibraryFeed,
  type CollectionRequest,
  type ExampleFeed,
  type GatekeeperLibraries,
  type JsonObject,
  type ResolvedFeed,
} from "@open-data-pt/gatekeeper";
import { isNormalizedFrame } from "../packages/contract/src/validation";
import { readFrames } from "../apps/kernel/src/frames";
import { MAX_RECORD_BYTES } from "../apps/kernel/src/blob-budget";
import { jsonAs } from "./support";
import { RUNNABLE } from "@open-data-pt/gatekeeper/catalog";
import { CARRIED, carriedLibraries, datasetOf, feedsOf } from "../apps/gatekeeper/tests/catalog";

/**
 * Collects curated examples from their real sources, the way the kernel
 * would, and reads the output through the kernel's own frame validation.
 * Opt-in because it calls public services: set LIVE_EXAMPLES to "all" or to
 * a comma-separated list of example slugs and publisher keys, a publisher's
 * key meaning every feed of their datasets (`LIVE_EXAMPLES=apa`).
 */
const SELECTED =
  process.env.LIVE_EXAMPLES?.split(",")
    .map((selection) => selection.trim())
    .filter(Boolean) ?? [];

/** Whether LIVE_EXAMPLES asks for this feed: every feed, the feed by its slug, or every feed of its publisher. */
function selected(example: ExampleFeed): boolean {
  return SELECTED.includes("all") || SELECTED.includes(example.slug) || SELECTED.includes(datasetOf(example).publisher);
}
const MIB = 1024 * 1024;

/** The wiring the Worker deploys, from the same declarations and vars, with the real fetch. */
const LIBRARIES: Array<{ libraries: GatekeeperLibraries; examples: readonly ExampleFeed[] }> = CARRIED.map((library) => ({
  libraries: carriedLibraries(library.deployment.source, {
    ML_CONSUMER_KEY: process.env.ML_CONSUMER_KEY,
    ML_CONSUMER_SECRET: process.env.ML_CONSUMER_SECRET,
    NASA_FIRMS_MAP_KEY: process.env.NASA_FIRMS_MAP_KEY,
  }),
  examples: feedsOf(library.deployment.source),
}));

/** The request the kernel builds for a live collection under this example's policy. */
function liveRequest(example: ExampleFeed, resolved: ResolvedFeed): CollectionRequest {
  const policy = example.policy.collection;
  const outputBytes = policy.maxOutputBytes ?? Math.max(MIB, Math.min(16 * MIB, policy.maxBytes * 4));
  const recordBytes = Math.min(policy.maxRecordBytes ?? 256 * 1024, MAX_RECORD_BYTES);
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: `live_${example.slug}`,
    feed: { id: "feed_live", slug: example.slug, title: example.title ?? datasetOf(example).title, description: example.description ?? datasetOf(example).description },
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

const cases = LIBRARIES.flatMap((library) => library.examples.filter(selected).map((example) => ({ slug: example.slug, example, libraries: library.libraries })));

describe.skipIf(cases.length === 0)("live examples", () => {
  it.each(cases)(
    "collects $slug",
    async ({ example, libraries }) => {
      const resolved = await resolveLibraryFeed(example.config, libraries);
      const request = liveRequest(example, resolved);
      const feed = RUNNABLE.get(example.slug);
      if (!feed) throw new Error(`No feed file defines ${example.slug}`);
      const result = await collectNormalized(request, feedCollector(feed, resolved.config, libraries));
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
      // An active event log is honestly empty when nothing is happening; every other curated example should carry data.
      if (resolved.semantics.defaultProductRole !== "event-log") expect((counts.get("record") ?? 0) + (counts.get("point") ?? 0)).toBeGreaterThan(0);
    },
    300_000,
  );
});
