import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectNormalized, libraryConfig, NORMALIZED_PROTOCOL, type CollectionRequest, type ExampleFeed } from "@open-data-pt/gatekeeper";
import { parliamentCollector } from "../apps/gatekeeper/src/publishers/assembleia-da-republica/parliament";
import { parliamentDocument } from "../apps/gatekeeper/src/publishers/assembleia-da-republica/parliament/parliament";
import { readFrames } from "../apps/kernel/src/frames";
import { feedsOf } from "./catalog";

// These opt-ins require separate record-processing authorization; they do not override a permission denial.
const SAMPLE_DIRECTORY = process.env.PARLIAMENT_SAMPLE_DIR;
const live =
  process.env.LIVE_PARLIAMENT?.split(",")
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
const samples = process.env.PARLIAMENT_SAMPLES === "1";

/** Aggregate-only validation; never copies real personal records into repository fixtures or logs. */
async function collect(example: ExampleFeed, fetcher: typeof fetch, mode: "saved-research" | "live"): Promise<void> {
  const config = libraryConfig(example.config);
  const collector = parliamentCollector({ config, fetcher });
  const resolved = await collector.resolve(config);
  const policy = example.policy.collection;
  const request: CollectionRequest = {
    protocol: NORMALIZED_PROTOCOL,
    collectionId: `${mode}_${config.feed}`,
    feed: { id: "validation", slug: example.slug, title: example.title, description: example.description },
    resolved,
    feedEpoch: "validation",
    mode: { kind: "live" },
    observedAt: new Date().toISOString(),
    deadline: new Date(Date.now() + policy.timeoutSeconds * 1000).toISOString(),
    limits: {
      sourceBytes: policy.maxBytes,
      outputBytes: policy.maxOutputBytes ?? 8 * 1024 * 1024,
      recordBytes: 256 * 1024,
      frameBytes: 272 * 1024,
      records: policy.maxRecords ?? 50_000,
      products: 16,
    },
  };
  const result = await collectNormalized(request, collector);
  if (result.kind !== "batch") throw new Error(`${example.slug}: ${JSON.stringify(result)}`);
  let outputBytes = 0;
  let maximumFrame = 0;
  const counts = new Map<string, number>();
  const partial: string[] = [];
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
    if (frame.type === "record") {
      counts.set(frame.productKey, (counts.get(frame.productKey) ?? 0) + 1);
      // Check names of fields only; do not log source values or private biographical fields.
      expect(Object.keys(frame.value.payload).some((key) => ["CadDtNascimento", "CadSexo", "PetAutor", "Documentos"].includes(key))).toBe(false);
    }
    if (frame.type === "complete") {
      expect(frame.quality.rejectedRecords).toBe(0);
      for (const product of frame.products ?? []) if (product.completeness) partial.push(`${product.productKey}:${product.completeness}`);
    }
  }
  console.info(JSON.stringify({ mode, slug: example.slug, outputBytes, maximumFrame, counts: Object.fromEntries(counts), partial }));
  expect(counts.get("header")).toBe(1);
  expect(counts.get("complete")).toBe(1);
  expect(counts.get("record")).toBeGreaterThan(0);
}

/** Opt-in local source-size check against the previously downloaded research; this is NOT live verification. */
describe.skipIf(!samples)("Parliament saved research normalization", () => {
  it.each(feedsOf("parliament"))(
    "validates the complete recorded $slug source with aggregate-only output",
    async (example) => {
      if (!SAMPLE_DIRECTORY) throw new Error("Set PARLIAMENT_SAMPLE_DIR to an explicitly authorized research directory");
      const document = parliamentDocument(libraryConfig(example.config));
      const fetcher: typeof fetch = async (input) => {
        const url = new URL(input.toString());
        const name = url.hostname === "www.parlamento.pt" ? `${url.search ? "parl2_" : "parl_"}${document.page}.html` : `parlj_${document.filename}`;
        return new Response(new Uint8Array(readFileSync(`${SAMPLE_DIRECTORY}/${name}`)));
      };
      await collect(example, fetcher, "saved-research");
    },
    180_000,
  );
});

/** No guessed download links: the live collector must discover the public folder and file itself. */
describe.skipIf(live.length === 0)("Parliament live public-directory collection", () => {
  it.each(feedsOf("parliament").filter((example) => live.includes("all") || live.includes(example.config.feed ?? "") || live.includes(example.slug)))(
    "collects $slug live",
    async (example) => {
      await collect(example, (input, init) => fetch(input, init), "live");
    },
    240_000,
  );
});
