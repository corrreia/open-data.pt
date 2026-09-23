import { describe, expect, it } from "vitest";
import { streamCsvRecords, streamCsvRows, type CsvStreamOptions } from "@open-data-pt/gatekeeper";

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

const ALPHABET = ["a", "b", "Z", "1", " ", ",", ";", "\t", '"', "\n", "\r\n", "ç", "€", "😀", "'"];

function randomField(next: () => number): string {
  let text = "";
  const length = Math.floor(next() * 8);
  for (let index = 0; index < length; index += 1) text += ALPHABET[Math.floor(next() * ALPHABET.length)]!;
  return text;
}

/** The reference serializer: RFC 4180 quoting whenever a field needs it, and sometimes when it does not. */
function serialize(rows: string[][], delimiter: string, lineEnd: string, trailing: boolean, next: () => number): string {
  const lines = rows.map((row) =>
    row
      .map((field) => {
        const needsQuotes = field.includes(delimiter) || field.includes('"') || field.includes("\n") || field.includes("\r") || (field === "" && row.length === 1);
        return needsQuotes || next() > 0.8 ? `"${field.replaceAll('"', '""')}"` : field;
      })
      .join(delimiter),
  );
  return lines.join(lineEnd) + (trailing ? lineEnd : "");
}

function chunk(bytes: Uint8Array, sizes: "one" | "whole" | (() => number)): Uint8Array[] {
  if (sizes === "whole") return [bytes];
  const chunks: Uint8Array[] = [];
  for (let offset = 0; offset < bytes.byteLength;) {
    const size = sizes === "one" ? 1 : 1 + Math.floor(sizes() * 23);
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

async function rows(body: ReadableStream<Uint8Array>, options?: CsvStreamOptions): Promise<string[][]> {
  const parsed: string[][] = [];
  for await (const row of streamCsvRows(body, options)) parsed.push(row);
  return parsed;
}

async function records(body: ReadableStream<Uint8Array>, options?: CsvStreamOptions): Promise<{ header: string[]; records: Array<Record<string, string>> }> {
  const stream = streamCsvRecords(body, options);
  const header = await stream.header;
  const parsed: Array<Record<string, string>> = [];
  for await (const record of stream.records) parsed.push(record);
  return { header, records: parsed };
}

/** Windows-1252 bytes for text made of Latin-1 characters and the euro sign. */
function windows1252(text: string): Uint8Array {
  return Uint8Array.from([...text].map((character) => (character === "€" ? 0x80 : character.charCodeAt(0))));
}

describe("streamCsvRows", () => {
  it("matches the reference table for random quoted content under random, single-byte and whole chunkings", async () => {
    const next = random(1234);
    for (let round = 0; round < 120; round += 1) {
      const width = 2 + Math.floor(next() * 4);
      const table = Array.from({ length: 1 + Math.floor(next() * 6) }, () => Array.from({ length: width }, () => randomField(next)));
      const delimiter = [",", ";", "\t"][round % 3]!;
      const text = serialize(table, delimiter, round % 2 === 0 ? "\r\n" : "\n", next() > 0.5, next);
      for (const sizes of ["whole", "one", next] as const) {
        expect(await rows(textStream(text, sizes), { delimiter }), `round ${round}`).toEqual(table);
      }
    }
  });

  it("detects the delimiter from the first line, ignoring delimiters inside quotes", async () => {
    expect(await rows(textStream('"a,b,c";x;y\n1;2;3\n', "one"))).toEqual([
      ["a,b,c", "x", "y"],
      ["1", "2", "3"],
    ]);
    expect(await rows(textStream("a\tb\n1\t2", "one"))).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(await rows(textStream("a,b\n1,2\n"))).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(await rows(textStream("single\nline"))).toEqual([["single"], ["line"]]);
  });

  it("strips a UTF-8 BOM split across chunks and handles lone CR line endings", async () => {
    const bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode("nome;valor\rÉvora;1\r")]);
    expect(await rows(streamOf(chunk(bytes, "one")))).toEqual([
      ["nome", "valor"],
      ["Évora", "1"],
    ]);
  });

  it("decodes Windows-1252 when asked to read latin1", async () => {
    const bytes = windows1252("Município;População\nÉvora;€ 5\n");
    expect(await rows(streamOf(chunk(bytes, "one")), { encoding: "latin1" })).toEqual([
      ["Município", "População"],
      ["Évora", "€ 5"],
    ]);
  });

  it("skips rows before the header row and keeps blank lines as raw rows", async () => {
    expect(await rows(textStream("Title\n\nname,value\nA,1\n\nB,2\n", "one"), { headerRow: 2 })).toEqual([["name", "value"], ["A", "1"], [""], ["B", "2"]]);
  });

  it("rejects an oversized row and an unterminated quote", async () => {
    await expect(rows(textStream(`a,b\n${"x".repeat(200)},1\n`, "one"), { maxRowBytes: 64 })).rejects.toMatchObject({ code: "response-too-large" });
    await expect(rows(textStream(`a,b\n"${"é".repeat(40)}",1\n`), { maxRowBytes: 64 })).rejects.toMatchObject({ code: "response-too-large" });
    expect(await rows(textStream(`a,b\n${"x".repeat(60)},1\n`, "one"), { maxRowBytes: 64 })).toHaveLength(2);
    await expect(rows(textStream('a,b\n"open,1\n'))).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("cancels the source when the consumer stops early", async () => {
    let cancelled = false;
    for await (const row of streamCsvRows(
      streamOf(chunk(new TextEncoder().encode("a,b\n1,2\n3,4\n"), "one"), () => {
        cancelled = true;
      }),
    )) {
      expect(row).toEqual(["a", "b"]);
      break;
    }
    expect(cancelled).toBe(true);
  });
});

describe("streamCsvRecords", () => {
  it("resolves a unique trimmed header, pads short rows and skips blank rows", async () => {
    const text = "Report\n\n a ;a;;a_2; b \n1;2;3;4;5\n\n6;7\n";
    for (const sizes of ["whole", "one"] as const) {
      expect(await records(textStream(text, sizes), { headerRow: 2 })).toEqual({
        header: ["a", "a_2", "column_3", "a_2_2", "b"],
        records: [
          { a: "1", a_2: "2", column_3: "3", a_2_2: "4", b: "5" },
          { a: "6", a_2: "7", column_3: "", a_2_2: "", b: "" },
        ],
      });
    }
  });

  it("reads the header before any record is requested, and nothing from an empty body", async () => {
    const stream = streamCsvRecords(textStream("x,y\n1,2\n", "one"));
    expect(await stream.header).toEqual(["x", "y"]);
    const parsed: Array<Record<string, string>> = [];
    for await (const record of stream.records) parsed.push(record);
    expect(parsed).toEqual([{ x: "1", y: "2" }]);
    expect(await records(textStream(""))).toEqual({ header: [], records: [] });
  });

  it("keeps quoted newlines inside one record", async () => {
    expect((await records(textStream('name,note\r\n"Lisbon, city","line one\nline two"\r\nPorto,\r\n', "one"))).records).toEqual([
      { name: "Lisbon, city", note: "line one\nline two" },
      { name: "Porto", note: "" },
    ]);
  });
});
