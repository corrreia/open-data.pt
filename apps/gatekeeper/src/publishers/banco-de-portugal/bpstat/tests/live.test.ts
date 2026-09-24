import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { NORMALIZED_PROTOCOL, collectNormalized, isJsonObject, isNormalizedFrame, parseJson, type CollectionRequest, type ExampleFeed, type NormalizedFrame } from "#/index";
import { feedCollection, feedsOf } from "#/tests/catalog";

// Opt in by slug or with `bpstat`; no production writes are made.
const selected = (process.env.LIVE_CATALOGS ?? "").split(",");
const examples = feedsOf("bpstat").filter((example) => example.config.seriesIds !== undefined);

describe("BPstat live collection", () => {
  for (const example of examples) {
    it.skipIf(!selected.includes(example.slug) && !selected.includes(example.config.source ?? ""))(
      example.slug,
      async () => {
        let requests = 0;
        const fetcher: typeof fetch = (input, init) => {
          requests += 1;
          return fetch(input, init);
        };
        const { resolved, collector } = await feedCollection(example.slug, { fetcher });
        const result = await collectNormalized(request(example, resolved), collector);
        if (result.kind !== "batch") throw new Error(JSON.stringify(result));
        const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
        const frames = new TextDecoder()
          .decode(bytes)
          .trim()
          .split("\n")
          .map((line): NormalizedFrame => {
            const value = parseJson(line);
            if (!isJsonObject(value) || !isNormalizedFrame(value)) throw new Error(`Invalid frame: ${line.slice(0, 200)}`);
            const untrusted: unknown = value;
            // SAFETY: isNormalizedFrame checked the discriminant and every field of this frame variant, as the kernel's reader does.
            return untrusted as NormalizedFrame;
          });
        const header = frames[0];
        const complete = frames.at(-1);
        if (header?.type !== "header" || complete?.type !== "complete") throw new Error("Incomplete normalized stream");
        expect(header.completeness).toBe("complete");
        expect(complete.quality.rejectedRecords).toBe(0);
        expect(complete.counts.records + complete.counts.points).toBeGreaterThan(0);
        expect(bytes.length).toBeLessThanOrEqual(example.policy.collection.maxOutputBytes ?? 16 * 1024 * 1024);
        const keys = new Set<string>();
        const seriesCounts = new Map<string, number>();
        for (const frame of frames) {
          if (frame.type === "point") {
            const key = JSON.stringify([frame.productKey, frame.value.seriesKey, frame.value.eventTime]);
            expect(keys.has(key), key).toBe(false);
            keys.add(key);
            const series = JSON.stringify([frame.productKey, frame.value.seriesKey]);
            seriesCounts.set(series, (seriesCounts.get(series) ?? 0) + 1);
            expect(frame.value.unit).not.toBe("unknown");
            expect(frame.value.unit).not.toBe("value");
          }
          if (frame.type === "record") {
            const key = JSON.stringify([frame.productKey, frame.value.entityKey]);
            expect(keys.has(key), key).toBe(false);
            keys.add(key);
          }
        }
        if (example.config.lastN) expect(Math.max(...seriesCounts.values())).toBeLessThanOrEqual(Number(example.config.lastN));
        const measurement = JSON.stringify({
          slug: example.slug,
          requests,
          bytes: bytes.length,
          ...complete.counts,
          sourceRows: complete.quality.acceptedRecords,
          watermarks: complete.products?.map((product) => product.watermark) ?? header.products.map((product) => product.watermark),
        });
        if (process.env.CATALOG_MEASUREMENTS) appendFileSync(process.env.CATALOG_MEASUREMENTS, `${measurement}\n`);
        console.log(measurement);
      },
      210_000,
    );
  }
});

function request(example: ExampleFeed, resolved: CollectionRequest["resolved"]): CollectionRequest {
  const collection = example.policy.collection;
  return {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: `live-${example.slug}`,
    feed: { id: example.slug, slug: example.slug, title: example.title, description: example.description },
    resolved,
    feedEpoch: "catalog-probe",
    mode: { kind: "live" },
    observedAt: new Date().toISOString(),
    deadline: new Date(Date.now() + collection.timeoutSeconds * 1000).toISOString(),
    limits: {
      sourceBytes: collection.maxBytes,
      outputBytes: collection.maxOutputBytes ?? 16 * 1024 * 1024,
      frameBytes: 1024 * 1024,
      recordBytes: collection.maxRecordBytes ?? 512 * 1024,
      records: collection.maxRecords ?? 20_000,
      products: 32,
    },
  };
}
