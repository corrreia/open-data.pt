import { appendFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  NORMALIZED_PROTOCOL, collectNormalized, isNormalizedFrame, libraryConfig, parseJson,
  type CollectionRequest, type ExampleFeed, type NormalizedFrame,
} from "../packages/gatekeeper-shared/src/index";
import { opendatasoftCollector } from "../packages/gatekeeper-shared/src/formats/opendatasoft/collector";
import { CATALOG_EXAMPLES as ODS_EXAMPLES } from "../packages/gatekeeper-shared/src/formats/opendatasoft/catalog-examples";
import { bpstatCollector } from "../packages/gatekeeper-shared/src/sources/bpstat/collector";
import { CATALOG_EXAMPLES as BPSTAT_EXAMPLES } from "../packages/gatekeeper-shared/src/sources/bpstat/catalog-examples";

// Opt in to precisely the new catalog feeds; no production writes or topic wiring is required.
const selected = (process.env.LIVE_CATALOGS ?? "").split(",");
const examples = [...ODS_EXAMPLES, ...BPSTAT_EXAMPLES];

describe("catalog expansion live collection", () => {
  for (const example of examples) {
    it.skipIf(!selected.includes(example.slug) && !selected.includes(example.config.source ?? ""))(
      example.slug, async () => {
        const config = libraryConfig(example.config);
        let requests = 0;
        const fetcher: typeof fetch = (input, init) => { requests += 1; return fetch(input, init); };
        const collector = example.config.source === "opendatasoft"
          ? opendatasoftCollector({ config, hosts: "e-redes.opendatasoft.com,transparencia.sns.gov.pt", fetcher })
          : bpstatCollector({ config, apiOrigin: "https://bpstat.bportugal.pt", fetcher });
        const resolved = await collector.resolve(config);
        const result = await collectNormalized(request(example, resolved), collector);
        if (result.kind !== "batch") throw new Error(JSON.stringify(result));
        const bytes = new Uint8Array(await new Response(result.stream).arrayBuffer());
        const frames = new TextDecoder().decode(bytes).trim().split("\n").map((line): NormalizedFrame => {
          const value = parseJson(line);
          if (!isNormalizedFrame(value)) throw new Error(`Invalid frame: ${line.slice(0, 200)}`);
          return value;
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
        if (config.lastN) expect(Math.max(...seriesCounts.values())).toBeLessThanOrEqual(Number(config.lastN));
        const measurement = JSON.stringify({ slug: example.slug, requests, bytes: bytes.length, ...complete.counts, sourceRows: complete.quality.acceptedRecords, watermarks: complete.products?.map((product) => product.watermark) ?? header.products.map((product) => product.watermark) });
        if (process.env.CATALOG_MEASUREMENTS) appendFileSync(process.env.CATALOG_MEASUREMENTS, `${measurement}\n`);
        console.log(measurement);
      }, 210_000,
    );
  }
});

function request(example: ExampleFeed, resolved: CollectionRequest["resolved"]): CollectionRequest {
  const collection = example.policy.collection;
  return {
    protocol: NORMALIZED_PROTOCOL, collectionId: `live-${example.slug}`,
    feed: { id: example.slug, slug: example.slug, title: example.title, description: example.description },
    resolved, feedEpoch: "catalog-probe", mode: { kind: "live" },
    observedAt: new Date().toISOString(), deadline: new Date(Date.now() + collection.timeoutSeconds * 1000).toISOString(),
    limits: {
      sourceBytes: collection.maxBytes, outputBytes: collection.maxOutputBytes ?? 16 * 1024 * 1024,
      frameBytes: 1024 * 1024, recordBytes: collection.maxRecordBytes ?? 512 * 1024,
      records: collection.maxRecords ?? 20_000, products: 32,
    },
  };
}
