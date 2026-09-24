import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectNormalized, libraryConfig, NORMALIZED_PROTOCOL, type CollectionRequest, type ExampleFeed, type NormalizedFrame, feedNormalizer } from "@open-data-pt/gatekeeper";
import { PARLIAMENT_NORMALIZER } from "../apps/gatekeeper/src/publishers/assembleia-da-republica/parliament/index";
import { parliamentDocument, type ParliamentDocument } from "../apps/gatekeeper/src/publishers/assembleia-da-republica/parliament/parliament";
import { feedCollection, feedsOf } from "../apps/gatekeeper/tests/catalog";
import { readFixture } from "../apps/gatekeeper/tests/support";
import { readFrames } from "../apps/kernel/src/frames";

/*
 * The Parliament library's output read back the way the kernel reads it: every frame through `readFrames`.
 * The library's own tests sit beside it, in apps/gatekeeper/src/publishers/assembleia-da-republica/parliament/tests/.
 */

function fixture(feed: string): string {
  return readFixture(new URL(`../apps/gatekeeper/src/publishers/assembleia-da-republica/parliament/tests/fixtures/${feed}.json`, import.meta.url));
}
function chunked(text: string, size = 1): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(text);
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset >= bytes.length) {
        controller.close();
        return;
      }
      const chunk = bytes.slice(offset, offset + size);
      offset += chunk.length;
      controller.enqueue(chunk);
    },
  });
}
/** The public directory's two listings and the download they lead to, for one document. */
function sourceFetcher(doc: ParliamentDocument, status = 200): typeof fetch {
  const token = "c3ludGhldGljLXBhdGg=";
  const folderUrl = new URL(doc.pageUrl);
  folderUrl.searchParams.set("t", "abcdef0123456789");
  folderUrl.searchParams.set("Path", token);
  const download = new URL("https://app.parlamento.pt/webutils/docs/doc.txt");
  download.searchParams.set("path", token);
  download.searchParams.set("fich", doc.filename);
  download.searchParams.set("Inline", "true");
  const escaped = (value: string) => value.replaceAll("&", "&amp;");
  const landing = `<link rel="canonical" href="http://www.parlamento.pt:80/"><a href="${escaped(folderUrl.pathname + folderUrl.search)}" title="Pasta ${doc.legislature} Legislatura">Folder</a>`;
  const folder = `<a title="${doc.filename}" href="${escaped(download.toString())}">JSON</a>`;
  return async (input) => {
    const url = new URL(input.toString());
    if (url.origin === "https://www.parlamento.pt") return new Response(url.search ? folder : landing);
    expect(url.toString()).toBe(download.toString());
    return status === 304
      ? new Response(null, { status: 304 })
      : new Response(chunked(fixture(doc.feed)), { headers: { ETag: '"document-v1"', "Last-Modified": "Tue, 15 Sep 2026 12:00:00 GMT" } });
  };
}

describe("Parliament frames as the kernel reads them", () => {
  it.each(feedsOf("parliament"))("streams $slug through its own feed file and the complete protocol-v4 collector", async (example) => {
    const doc = parliamentDocument(libraryConfig(example.config));
    const { resolved, collector } = await feedCollection(example.slug, { fetcher: sourceFetcher(doc) });
    const request: CollectionRequest = {
      protocol: NORMALIZED_PROTOCOL,
      collectionId: `fixture_${doc.feed}`,
      feed: { id: "fixture", slug: example.slug, title: example.title, description: example.description },
      resolved,
      feedEpoch: "fixture",
      observedAt: "2026-09-15T00:00:00Z",
      deadline: new Date(Date.now() + 30_000).toISOString(),
      mode: { kind: "live" },
      limits: { sourceBytes: doc.sourceBytes, outputBytes: 8 * 1024 * 1024, recordBytes: 256 * 1024, frameBytes: 272 * 1024, records: 50_000, products: 16 },
    };
    const result = await collectNormalized(request, collector);
    if (result.kind !== "batch") throw new Error(JSON.stringify(result));
    const frames: NormalizedFrame[] = [];
    for await (const frame of readFrames(result.stream, request.limits, {
      collectionId: request.collectionId,
      resourceKey: resolved.resourceKey,
      configHash: resolved.configHash,
      feedEpoch: request.feedEpoch,
      mode: request.mode,
      deadline: request.deadline,
    }))
      frames.push(frame);
    expect(frames[0]).toMatchObject({ type: "header", protocol: NORMALIZED_PROTOCOL, normalizer: feedNormalizer(PARLIAMENT_NORMALIZER) });
    expect(frames.at(-1)).toMatchObject({ type: "complete", quality: { rejectedRecords: 0 } });
    expect(frames.filter((frame) => frame.type === "record").length).toBeGreaterThan(0);
    expect(JSON.stringify(frames)).not.toContain("c3ludGhldGljLXBhdGg");
    const header = frames[0];
    if (header?.type !== "header") throw new Error("Missing header");
    const checkpoint = header.checkpoint;
    const { collector: again } = await feedCollection(example.slug, { fetcher: sourceFetcher(doc, 304) });
    expect(await collectNormalized({ ...request, checkpoint }, again)).toMatchObject({ kind: "unchanged" });
  });
});

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
  const { resolved, collector } = await feedCollection(example.slug, { fetcher });
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
