import { describe, expect, it } from "vitest";
import { NORMALIZED_PROTOCOL, collectNormalized, libraryConfig, type CollectionRequest, type ExampleFeed, type NormalizedCollector } from "@open-data-pt/gatekeeper-shared";
import { OPENDATASOFT_EXAMPLES, opendatasoftCollector } from "@open-data-pt/gatekeeper-shared/formats/opendatasoft";
import { INE_EXAMPLES, ineCollector } from "@open-data-pt/gatekeeper-shared/sources/ine";
import { readFrames } from "../apps/kernel/src/frames";
import { MAX_RECORD_BYTES } from "../apps/kernel/src/blob-budget";

const selected = process.env.LIVE_HISTORY_EXPANSION?.split(",") ?? [];
const examples = [...OPENDATASOFT_EXAMPLES, ...INE_EXAMPLES].filter((example) => selected.includes(example.slug));

function sourceCollector(example: ExampleFeed): NormalizedCollector {
  const config = libraryConfig(example.config);
  return example.config.source === "ine"
    ? ineCollector({ config, apiOrigin: "https://www.ine.pt", fetcher: fetch })
    : opendatasoftCollector({ config, hosts: example.config.host!, fetcher: fetch });
}

async function request(example: ExampleFeed): Promise<CollectionRequest> {
  const collector = sourceCollector(example);
  const policy = example.policy.collection;
  const outputBytes = policy.maxOutputBytes ?? Math.max(1_048_576, Math.min(16 * 1_048_576, policy.maxBytes * 4));
  const recordBytes = Math.min(policy.maxRecordBytes ?? 256 * 1024, MAX_RECORD_BYTES);
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: `history-probe-${example.slug}`,
    feed: { id: "probe", slug: example.slug, title: example.title, description: example.description },
    resolved: await collector.resolve(libraryConfig(example.config)),
    feedEpoch: "probe",
    mode: { kind: "live" },
    limits: {
      sourceBytes: policy.maxBytes,
      outputBytes,
      recordBytes,
      frameBytes: Math.min(outputBytes, recordBytes + 16 * 1024),
      records: policy.maxRecords ?? 1_000_000,
      products: 64,
    },
    deadline: new Date(Date.now() + policy.timeoutSeconds * 1000).toISOString(),
    observedAt: new Date().toISOString(),
  };
}

/** Source reads only. No kernel instance is started and no history is written anywhere. */
describe.skipIf(examples.length === 0)("new source automatic-history smoke checks", () => {
  it.each(examples)(
    "walks one older slice of $slug",
    async (example) => {
      const collector = sourceCollector(example);
      const live = await request(example);
      expect(live.resolved.history, "Only explicitly history-capable feeds should be selected").toBeDefined();
      let oldest: string | undefined;
      const first = await collectNormalized(live, collector);
      if (first.kind !== "batch") throw new Error(`Live source returned ${JSON.stringify(first)}`);
      const liveScope = {
        collectionId: live.collectionId,
        resourceKey: live.resolved.resourceKey,
        configHash: live.resolved.configHash,
        feedEpoch: live.feedEpoch,
        mode: live.mode,
        deadline: live.deadline,
      };
      for await (const frame of readFrames(first.stream, live.limits, liveScope)) {
        const time = frame.type === "point" || frame.type === "record" ? frame.value.eventTime : undefined;
        if (time && (!oldest || time < oldest)) oldest = time;
      }
      const before = oldest ?? live.observedAt;
      const historical: CollectionRequest = {
        ...live,
        collectionId: `older-${example.slug}`,
        mode: { kind: "history", cursor: { before } },
        deadline: new Date(Date.now() + example.policy.collection.timeoutSeconds * 1000).toISOString(),
      };
      const result = await collectNormalized(historical, collector);
      if (result.kind === "exhausted") {
        console.info(`${example.slug}: exhausted before ${before}`);
        return;
      }
      if (result.kind !== "batch") throw new Error(`History source returned ${JSON.stringify(result)}`);
      const scope = {
        collectionId: historical.collectionId,
        resourceKey: historical.resolved.resourceKey,
        configHash: historical.resolved.configHash,
        feedEpoch: historical.feedEpoch,
        mode: historical.mode,
        deadline: historical.deadline,
      };
      let complete = false;
      let rows = 0;
      for await (const frame of readFrames(result.stream, historical.limits, scope)) {
        if (frame.type === "point" || frame.type === "record") {
          rows += 1;
          if (frame.value.eventTime) expect(Date.parse(frame.value.eventTime)).toBeLessThan(Date.parse(before));
        }
        if (frame.type === "complete") {
          complete = true;
          expect(frame.exhausted || frame.nextCursor).toBeTruthy();
        }
      }
      expect(complete).toBe(true);
      console.info(`${example.slug}: ${rows} older rows before ${before}`);
    },
    360_000,
  );
});
