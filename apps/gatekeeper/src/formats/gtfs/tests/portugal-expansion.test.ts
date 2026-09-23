import { describe, expect, it } from "vitest";
import {
  isJsonArray,
  isJsonObject,
  isJsonString,
  libraryConfig,
  parseJson,
  type ExampleFeed,
  type JsonObject,
  type JsonValue,
  type NormalizedRow,
  type TransformContext,
} from "#/index";
import { transformGtfs } from "#/formats/gtfs/index";
import { GtfsCsvReader } from "#/formats/gtfs/csv";
import { datasetOf, feedCollection, feedsOf } from "#/tests/catalog";
import { readFixture } from "#/tests/support";

const GTFS = array(parseJson(readFixture(new URL("./fixtures/portugal-expansion.json", import.meta.url)))).map(object);

function object(value: JsonValue | undefined): JsonObject {
  if (!isJsonObject(value)) throw new Error("Expected object");
  return value;
}
function array(value: JsonValue | undefined): JsonValue[] {
  if (!isJsonArray(value)) throw new Error("Expected array");
  return value;
}
function text(value: JsonValue | undefined): string {
  if (!isJsonString(value)) throw new Error("Expected string");
  return value;
}
function bytesInChunks(bytes: Uint8Array, size: number): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream({
    pull(controller) {
      if (offset === bytes.length) {
        controller.close();
        return;
      }
      const chunk = bytes.slice(offset, offset + size);
      offset += chunk.length;
      controller.enqueue(chunk);
    },
  });
}
function context(entry: ExampleFeed, observedAt = "2026-09-15T00:00:00Z"): TransformContext {
  return {
    observedAt,
    feed: {
      slug: entry.slug,
      title: entry.title ?? datasetOf(entry).title,
      description: entry.description ?? datasetOf(entry).description,
      config: libraryConfig(entry.config),
      semantics: { domainSubject: "reference", defaultProductRole: "reference" },
    },
  };
}
describe("Portuguese transport expansion", () => {
  it.each(GTFS)("normalizes the recorded $slug schedule through one-byte ZIP chunks", async (recorded) => {
    const entry = feedsOf("gtfs").find((entry) => entry.slug === recorded.slug);
    if (!entry) throw new Error("Missing GTFS example");
    const { resolved, collector } = await feedCollection(entry.slug, {
      fetcher: async (_input, init) => {
        // IIS on Fertagus negotiates application/x-zip-compressed, otherwise HTTP 406.
        expect(new Headers(init?.headers).get("accept")).toContain("application/x-zip-compressed");
        return new Response(zip(object(recorded.files)));
      },
    });
    expect(resolved.config.url).toBe(recorded.source);
    const fetched = await collector.source(undefined, { kind: "live" }, new AbortController().signal);
    if (fetched.kind !== "body") throw new Error("Expected GTFS archive");
    const bytes = new Uint8Array(await new Response(fetched.body).arrayBuffer());
    const transformed = transformGtfs(bytesInChunks(bytes, 1), context(entry));
    const rows: NormalizedRow[] = [];
    for await (const row of transformed.rows) rows.push(row);
    expect(rows.length).toBeGreaterThan(0);
    expect(transformed.finish().quality.rejectedRecords).toBe(0);
    expect(transformed.finish().products).toEqual([]);
    expect(transformed.products.every((product) => rows.some((row) => row.productKey === product.productKey))).toBe(true);
    expect(rows.every((row) => row.record?.eventTime === undefined)).toBe(true);
    expect(entry.policy.collection.cadenceSeconds).toBe(86_400);
  });

  it("trims GTFS header padding without trimming values and rejects resulting duplicates", () => {
    const reader = new GtfsCsvReader();
    expect(reader.push("shape_id, shape_pt_lat, shape_pt_lon, shape_pt_sequence\n1,41.5,-8.4,0\n")).toEqual([
      { "shape_id": "1", "shape_pt_lat": "41.5", "shape_pt_lon": "-8.4", "shape_pt_sequence": "0" },
    ]);
    const duplicate = new GtfsCsvReader();
    expect(() => duplicate.push("id, id\n")).toThrow("unique");
    expect(new GtfsCsvReader().push("id,name\n1, padded name \n")[0]?.name).toBe(" padded name ");
  });
});

/** Tiny stored ZIP fixture; the archive reader also has separate deflate/descriptor tests. */
function zip(files: JsonObject): Uint8Array {
  const parts: Uint8Array[] = [];
  for (const [filename, value] of Object.entries(files)) {
    const name = new TextEncoder().encode(filename);
    const data = new TextEncoder().encode(text(value));
    const header = new DataView(new ArrayBuffer(30));
    header.setUint32(0, 0x04034b50, true);
    header.setUint16(4, 20, true);
    header.setUint32(18, data.length, true);
    header.setUint32(22, data.length, true);
    header.setUint16(26, name.length, true);
    parts.push(new Uint8Array(header.buffer), name, data);
  }
  parts.push(Uint8Array.of(0x50, 0x4b, 0x01, 0x02));
  const bytes = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return bytes;
}
