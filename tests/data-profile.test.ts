import { describe, expect, it } from "vitest";
import { profileStream, readCsvPage } from "../packages/gatekeeper-shared/src/formats/udata/transform/data-profile";

function chunkedText(value: string, sizes: number[]): ReadableStream<Uint8Array> {
  const bytes = new TextEncoder().encode(value);
  const chunks: Uint8Array[] = [];
  let offset = 0;
  for (const size of sizes) {
    chunks.push(bytes.slice(offset, offset + size));
    offset += size;
  }
  chunks.push(bytes.slice(offset));
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

describe("CSV profiling", () => {
  it("handles semicolons, quoted delimiters, newlines, and nullable values", async () => {
    const value = 'name;score;note\r\n"Lisbon; city";42;"line one\nline two"\r\nPorto;51;\r\n';

    expect(await profileStream(chunkedText(value, [19]), "csv", "text/csv")).toEqual({
      rowCount: 2,
      columns: [
        { name: "name", type: "string", nullable: false },
        { name: "score", type: "number", nullable: false },
        { name: "note", type: "string", nullable: true },
      ],
      sampleRows: [
        { name: "Lisbon; city", score: "42", note: "line one\nline two" },
        { name: "Porto", score: "51", note: null },
      ],
    });
  });

  it("profiles JSON rows streamed from a nested array, one byte at a time", async () => {
    const value = JSON.stringify({
      total: 2,
      results: [
        { day: "2026-09-01", open: true, count: 3 },
        { day: "2026-09-02", open: false, count: null },
      ],
    });
    const sizes = Array.from({ length: value.length }, () => 1);
    expect(await profileStream(chunkedText(value, sizes), "json", "application/json")).toEqual({
      rowCount: 2,
      columns: [
        { name: "day", type: "date", nullable: false },
        { name: "open", type: "boolean", nullable: false },
        { name: "count", type: "number", nullable: true },
      ],
      sampleRows: [
        { day: "2026-09-01", open: "true", count: "3" },
        { day: "2026-09-02", open: "false", count: null },
      ],
    });
  });

  it("returns an arbitrary page of rows", async () => {
    const page = await readCsvPage(chunkedText("name,value\nA,1\nB,2\nC,3\nD,4\n", [13]), 1, 2);

    expect(page.columns).toEqual(["name", "value"]);
    expect(page.rows).toEqual([
      { name: "B", value: "2" },
      { name: "C", value: "3" },
    ]);
  });
});
