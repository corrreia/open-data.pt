import { describe, expect, it } from "vitest";
import { isJsonObject, parseJson, streamJsonArray, streamNdjson, type JsonArrayStreamOptions, type JsonObject, type JsonValue } from "@open-data-pt/gatekeeper";

/** A small deterministic PRNG so failures reproduce. */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const ALPHABET = ["a", "Z", " ", '"', "\\", "\n", "\t", "/", "ç", "ã", "€", "😀", "", "]", "}", ",", "[", "{", ":"];

function randomString(next: () => number): string {
  let text = "";
  const length = Math.floor(next() * 12);
  for (let index = 0; index < length; index += 1) text += ALPHABET[Math.floor(next() * ALPHABET.length)]!;
  return text;
}

function randomValue(next: () => number, depth: number): JsonValue {
  const pick = Math.floor(next() * (depth > 3 ? 5 : 7));
  switch (pick) {
    case 0:
      return randomString(next);
    case 1:
      return Math.round((next() - 0.5) * 1e6) / 100;
    case 2:
      return next() > 0.5;
    case 3:
      return null;
    case 4:
      return Math.floor(next() * 1e9);
    case 5:
      return Array.from({ length: Math.floor(next() * 4) }, () => randomValue(next, depth + 1));
    default: {
      const object: JsonObject = {};
      const size = Math.floor(next() * 4);
      for (let index = 0; index < size; index += 1) object[randomString(next)] = randomValue(next, depth + 1);
      return object;
    }
  }
}

function chunk(bytes: Uint8Array, sizes: "one" | "whole" | (() => number)): Uint8Array[] {
  if (sizes === "whole") return [bytes];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength;) {
    const size = sizes === "one" ? 1 : 1 + Math.floor(sizes() * 17);
    chunks.push(bytes.slice(offset, offset + size));
    offset += size;
  }
  return chunks;
}

function streamOf(chunks: Uint8Array[], onCancel?: () => void): ReadableStream<Uint8Array> {
  let index = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks[index];
      index += 1;
      if (next === undefined) controller.close();
      else controller.enqueue(next);
    },
    cancel() {
      onCancel?.();
    },
  });
}

function textStream(text: string, sizes: "one" | "whole" | (() => number) = "whole"): ReadableStream<Uint8Array> {
  return streamOf(chunk(new TextEncoder().encode(text), sizes));
}

async function collect(body: ReadableStream<Uint8Array>, path: readonly string[], options?: JsonArrayStreamOptions): Promise<{ elements: JsonValue[]; envelope: JsonObject }> {
  const stream = streamJsonArray(body, path, options);
  const elements: JsonValue[] = [];
  for await (const element of stream.elements) elements.push(element);
  return { elements, envelope: stream.envelope() };
}

describe("streamJsonArray", () => {
  it("matches JSON.parse for random documents under random, single-byte and whole chunkings", async () => {
    const next = random(20260910);
    for (let documentIndex = 0; documentIndex < 150; documentIndex += 1) {
      const elements = Array.from({ length: Math.floor(next() * 6) }, () => randomValue(next, 0));
      const nested = next() > 0.5;
      const document: JsonObject = nested
        ? { before: randomValue(next, 2), result: { total: elements.length, records: elements, tail: randomString(next) }, after: randomValue(next, 2) }
        : { type: "FeatureCollection", features: elements, count: elements.length, meta: randomValue(next, 2) };
      const path = nested ? ["result", "records"] : ["features"];
      const text = JSON.stringify(document, null, documentIndex % 3 === 0 ? 2 : undefined);
      const expectedEnvelope = parseJson(text);
      if (!isJsonObject(expectedEnvelope)) throw new Error("fixture must be an object");
      const inner = nested && isJsonObject(expectedEnvelope.result) ? expectedEnvelope.result : expectedEnvelope;
      inner[path.at(-1)!] = [];

      for (const sizes of ["whole", "one", next] as const) {
        const result = await collect(textStream(text, sizes), path);
        expect(result.elements, `document ${documentIndex}`).toEqual(elements);
        expect(result.envelope, `document ${documentIndex}`).toEqual(expectedEnvelope);
      }
    }
  });

  it("streams a top-level array with nested arrays, whitespace and escapes split across chunks", async () => {
    const values: JsonValue[] = [[1, [2, [3]]], { 'a"]': 'x\\"y', b: [] }, "😀 ç €", -1.5e3, true, null];
    const text = ` \n[ ${values.map((value) => JSON.stringify(value)).join(" ,\r\n ")} ]\n`;
    for (const sizes of ["one", "whole"] as const) {
      const result = await collect(textStream(text, sizes), []);
      expect(result.elements).toEqual(values);
      expect(result.envelope).toEqual({});
    }
  });

  it("yields nothing for an empty array or a missing path but still returns the envelope", async () => {
    expect(await collect(textStream('{"features": [ ], "n": 0}', "one"), ["features"])).toEqual({ elements: [], envelope: { features: [], n: 0 } });
    expect(await collect(textStream('{"other": [1, 2], "n": 1}', "one"), ["features"])).toEqual({ elements: [], envelope: { other: [1, 2], n: 1 } });
    expect(await collect(textStream('{"features": null}'), ["features"])).toEqual({ elements: [], envelope: { features: null } });
    expect(await collect(textStream('{"a": {"features": [1]}}'), ["features"])).toEqual({ elements: [], envelope: { a: { features: [1] } } });
  });

  it("matches member names by their decoded value and streams only the first matching array", async () => {
    const result = await collect(textStream('{"fe\\u0061tures": [1, 2], "features": [3]}', "one"), ["features"]);
    expect(result.elements).toEqual([1, 2]);
  });

  it("strips a UTF-8 byte order mark split across chunks", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('{"results":["ção"]}')]);
    const result = await collect(streamOf(chunk(bytes, "one")), ["results"]);
    expect(result.elements).toEqual(["ção"]);
  });

  it("exposes members read before the array while its elements are still streaming", async () => {
    const stream = streamJsonArray(textStream('{"total_count": 3, "links": {"next": "x"}, "results": [{"a": 1}, {"a": 2}, {"a": 3}], "tail": true}', "one"), ["results"]);
    const iterator = stream.elements[Symbol.asyncIterator]();
    expect(await iterator.next()).toEqual({ done: false, value: { a: 1 } });
    expect(stream.envelope()).toEqual({ total_count: 3, links: { next: "x" }, results: [] });
    while (!(await iterator.next()).done) {
      /* drain */
    }
    expect(stream.envelope()).toEqual({ total_count: 3, links: { next: "x" }, results: [], tail: true });
  });

  it("rejects an element or envelope larger than its bound", async () => {
    await expect(collect(textStream(`{"features": [${JSON.stringify("x".repeat(100))}]}`, "one"), ["features"], { maxElementBytes: 64 })).rejects.toMatchObject({
      code: "response-too-large",
    });
    await expect(collect(textStream(`{"meta": ${JSON.stringify("x".repeat(100))}, "features": []}`), ["features"], { maxEnvelopeBytes: 64 })).rejects.toMatchObject({
      code: "response-too-large",
    });
    const fits = await collect(textStream(`{"features": [${JSON.stringify("x".repeat(40))}]}`, "one"), ["features"], { maxElementBytes: 64 });
    expect(fits.elements).toEqual(["x".repeat(40)]);
  });

  it("bounds an element by what it holds, not by the indentation it was sent with", async () => {
    const outline = {
      type: "MultiPolygon",
      name: "Herdade  do   Monte",
      coordinates: [
        [
          [
            [-7.1234567, 39.1234567],
            [-7.2, 39.2],
          ],
        ],
      ],
    };
    const pretty = JSON.stringify({ features: [outline] }, null, 8);
    const compact = JSON.stringify(outline).length;
    // Five times the element's size as sent, well inside it once its whitespace is left out.
    expect(pretty.length).toBeGreaterThan(compact * 3);
    for (const sizes of ["one", "whole"] as const) {
      const read = await collect(textStream(pretty, sizes), ["features"], { maxElementBytes: compact + 8 });
      // Spaces inside a string are the string's own, and stay.
      expect(read.elements).toEqual([outline]);
    }
    await expect(collect(textStream(pretty, "one"), ["features"], { maxElementBytes: compact - 8 })).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("rejects truncated and malformed documents", async () => {
    for (const text of [
      '{"features": [1, 2',
      '{"features": [1,]}',
      '{"features": [1,,2]}',
      '{"features": [1 2]}',
      '{"features": [{"a":}]}',
      '{"features": [1]}}',
      '{"features": [1]',
      "",
      '{"features": [1], "x": }',
    ]) {
      await expect(collect(textStream(text, "one"), ["features"]), text).rejects.toMatchObject({ code: "invalid-response" });
    }
  });

  it("cancels the source when the consumer stops early", async () => {
    let cancelled = false;
    const stream = streamJsonArray(
      streamOf(chunk(new TextEncoder().encode("[1, 2, 3, 4]"), "one"), () => {
        cancelled = true;
      }),
      [],
    );
    for await (const element of stream.elements) {
      expect(element).toBe(1);
      break;
    }
    expect(cancelled).toBe(true);
  });
});

describe("streamNdjson", () => {
  it("parses every line under random chunkings, with CRLF, blank lines and no final newline", async () => {
    const next = random(42);
    for (let round = 0; round < 60; round += 1) {
      const values = Array.from({ length: 1 + Math.floor(next() * 6) }, () => randomValue(next, 0));
      const text = values
        .map((value, index) => `${JSON.stringify(value)}${index % 2 === 0 ? "\r\n" : "\n\n"}`)
        .join("")
        .trimEnd();
      for (const sizes of ["whole", "one", next] as const) {
        const parsed: JsonValue[] = [];
        for await (const value of streamNdjson(textStream(text, sizes))) parsed.push(value);
        expect(parsed).toEqual(values);
      }
    }
  });

  it("rejects an oversized or malformed line", async () => {
    const read = async (text: string, options?: JsonArrayStreamOptions) => {
      const values: JsonValue[] = [];
      for await (const value of streamNdjson(textStream(text, "one"), options)) values.push(value);
      return values;
    };
    await expect(read(`{"a":1}\n${JSON.stringify("x".repeat(80))}\n`, { maxElementBytes: 32 })).rejects.toMatchObject({ code: "response-too-large" });
    await expect(read('{"a":1}\n{"a":\n')).rejects.toThrow("line 2");
  });
});
