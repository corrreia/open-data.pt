import { describe, expect, it } from "vitest";
import { isJsonArray, isJsonObject, type JsonObject, type NormalizedFrame } from "@open-data-pt/contract";
import { CollectionFailed, failureFrom } from "../src/engine";
import { readFrames, type FrameLimits, type FrameScope } from "../src/frames";
import { chunked, framed, framedText, header, limits, scope } from "./normalized-fixtures";

async function drain(stream: ReadableStream<Uint8Array>, frameLimits: FrameLimits = limits, frameScope: FrameScope = scope): Promise<NormalizedFrame[]> {
  const frames: NormalizedFrame[] = [];
  for await (const frame of readFrames(stream, frameLimits, frameScope)) frames.push(frame);
  return frames;
}

const event = (x: number): JsonObject => ({ type: "record", productKey: "events", value: { entityKey: `e${x}`, payload: { x } } });

/** The fixture's product twice, under two keys and one slug. */
function twoProducts(): JsonObject[] {
  const products = header().products;
  const [product] = isJsonArray(products) ? products : [];
  if (!isJsonObject(product)) throw new Error("The fixture header declares a product");
  return [product, { ...product, productKey: "more-events" }];
}

describe("normalized frame reader", () => {
  it("accepts a valid stream cut into single bytes, including inside multi-byte characters", async () => {
    const text = framedText([header(), { type: "record", productKey: "events", value: { entityKey: "é😀", payload: { x: 1, name: "Évora 😀" } } }, event(2)]);
    const frames = await drain(chunked(text, 1));
    expect(frames.map((frame) => frame.type)).toEqual(["header", "record", "record", "complete"]);
  });

  it.each([
    ["no header", framed([event(1)]), /omitted its header/],
    ["two headers", framed([header(), header()]), /duplicate headers/],
    ["an unknown product", framed([header(), { type: "record", productKey: "other", value: { entityKey: "a", payload: {} } }]), /unknown product/],
    [
      "a point for a record product",
      framed([header(), { type: "point", productKey: "events", value: { seriesKey: "s", eventTime: "2026-09-10T00:00:00.000Z", value: 1, unit: "", dimensions: {} } }]),
      /disagree/,
    ],
    ["data after completion", new Response(`${framedText([header()])}${JSON.stringify(event(1))}\n`).body!, /after completion/],
    ["a truncated stream", new Response(`${JSON.stringify(header())}\n${JSON.stringify(event(1))}\n`).body!, /truncated/],
    ["a blank line", new Response(`${JSON.stringify(header())}\n\n`).body!, /Blank/],
    ["invalid JSON", new Response(`${JSON.stringify(header())}\n{"type":\n`).body!, /invalid JSON/],
    ["invalid UTF-8", new Response(new Uint8Array([0x7b, 0xff, 0x0a])).body!, /UTF-8/],
    ["a finalized undeclared product", framed([header()], { products: [{ productKey: "other", completeness: "unknown" }] }), /undeclared product/],
    ["history progress on a live stream", framed([header()], { exhausted: true }), /Live collection returned history progress/],
    ["a header of an older protocol", framed([{ ...header(), protocol: "open-data-normalized/4" }]), /invalid frame/],
    ["two products under one slug", framed([{ ...header(), products: [...twoProducts()] }]), /Duplicate product slug/],
  ])("rejects %s", async (_name, stream, message) => {
    await expect(drain(stream)).rejects.toThrow(message);
  });

  it("enforces row, frame and output limits before a frame is handed out", async () => {
    await expect(drain(framed([header(), ...Array.from({ length: 11 }, (_, index) => event(index))]))).rejects.toThrow(/exceeds 10 rows/);
    await expect(drain(framed([header(), { type: "record", productKey: "events", value: { entityKey: "big", payload: { text: "x".repeat(2000) } } }]))).rejects.toThrow(
      /exceeds 1024 bytes/,
    );
    await expect(drain(framed([header(), event(1)]), { ...limits, outputBytes: 100, recordBytes: 80 })).rejects.toThrow(/exceeds/);
  });

  it("requires explicit continuation or exhaustion from a history slice", async () => {
    const history: FrameScope = { ...scope, mode: { kind: "history", cursor: { before: "2026-09-10T00:00:00.000Z" } } };
    await expect(drain(framed([header()]), limits, history)).rejects.toThrow(/continuation or exhaustion/);
    expect((await drain(framed([header()], { exhausted: true }), limits, history)).at(-1)).toMatchObject({ type: "complete", exhausted: true });
    await expect(drain(framed([header()], { nextCursor: { before: "2026-09-11T00:00:00.000Z" } }), limits, history)).rejects.toThrow(/moved forwards/);
  });

  it("treats a Gatekeeper on another protocol release as a passing failure, not a permanent one", () => {
    // During a deploy the kernel and a Gatekeeper differ for a minute; a permanent failure would cool the feed down for hours.
    const failure = failureFrom(new CollectionFailed("protocol-mismatch", true, 60));
    expect(failure).toMatchObject({ code: "protocol-mismatch", retryable: true, retryAfterSeconds: 60 });
    expect(failure).not.toHaveProperty("interrupted");
  });

  it("stops waiting on a stalled producer at the deadline", async () => {
    const stalled = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(`${JSON.stringify(header())}\n`));
      },
    });
    await expect(drain(stalled, limits, { ...scope, deadline: new Date(Date.now() + 150).toISOString() })).rejects.toThrow(/deadline/);
  });
});
