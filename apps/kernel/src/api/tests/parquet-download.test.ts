import { describe, expect, it } from "vitest";
import { byteRange, parquetDownload } from "#/api/parquet-download";
import { CADENCE_HEADER } from "#/api/cache";
import type { ProductDetail } from "#/registry/registry";
import { buildChunks } from "#/serving/chunks";
import { keys, ObjectStore } from "#/serving/object-store";
import { MemorySnapshots } from "#/tests/kernel-harness";

describe("the one byte range a Range header asks for", () => {
  it("reads a start and end, an open end, and a suffix, clamped to the file", () => {
    expect(byteRange("bytes=0-9", 100)).toEqual({ offset: 0, length: 10 });
    expect(byteRange("bytes=90-", 100)).toEqual({ offset: 90, length: 10 });
    expect(byteRange("bytes=95-500", 100)).toEqual({ offset: 95, length: 5 });
    expect(byteRange("bytes=-8", 100)).toEqual({ offset: 92, length: 8 });
    expect(byteRange("bytes=-800", 100)).toEqual({ offset: 0, length: 100 });
  });

  it("serves the whole file for no header, several ranges or other units, and refuses a start past the end", () => {
    for (const header of [null, "bytes=0-1,5-6", "items=0-1", "bytes=-", "bytes=9-3"]) expect(byteRange(header, 100)).toBeUndefined();
    expect(byteRange("bytes=100-", 100)).toBe("unsatisfiable");
    expect(byteRange("bytes=-0", 100)).toBe("unsatisfiable");
  });
});

async function product(snapshots: MemorySnapshots): Promise<ProductDetail> {
  const objects = new ObjectStore(snapshots);
  const chunks = await buildChunks([{ key: "a", json: JSON.stringify({ name: "Alfama", id: "a", _hash: "h", _time: {} }) }], {
    prefix: keys.prefix("feed_1", "places"),
    known: new Set(),
    put: async (key, body) => void (await objects.writeText(key, body)),
  });
  return {
    id: "prd_1",
    slug: "places",
    feedId: "feed_1",
    productKey: "places",
    title: "Places",
    description: "",
    role: "reference",
    kind: "record",
    schema: { fields: [{ id: "name", name: "name", type: "string", nullable: true }] },
    updateMode: "authoritative-snapshot",
    completeness: "complete",
    version: 1,
    status: "current",
    currentAcquisitionId: null,
    watermark: null,
    rowCount: 1,
    chunks,
    changesKey: null,
    seriesKey: null,
    seriesChangesKey: null,
    updatedAt: "2026-09-10T00:00:00.000Z",
    createdAt: "2026-09-10T00:00:00.000Z",
    stale: false,
    exposeHistory: false,
    historyMode: "latest",
    licence: null,
    attribution: null,
    staleAfterSeconds: 3600,
    cadenceSeconds: 600,
  };
}

const describeSource = async () => ({ apiUrl: "https://open-data.pt/api/products/places" });

describe("GET /api/products/{slug}.parquet", () => {
  it("answers the whole file as a download the edge can cache and cut ranges from", async () => {
    const snapshots = new MemorySnapshots();
    const response = await parquetDownload(new Request("https://open-data.pt/api/products/places.parquet"), await product(snapshots), snapshots, describeSource);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("application/vnd.apache.parquet");
    expect(response.headers.get("Content-Disposition")).toBe('attachment; filename="places.parquet"');
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Length")).toBe(String(body.byteLength));
    expect(response.headers.get("ETag")).toMatch(/^"[0-9a-f]+-[0-9a-f]+"$/);
    expect(response.headers.get(CADENCE_HEADER)).toBe("600");
    expect(new TextDecoder().decode(body.slice(0, 4))).toBe("PAR1");
  });

  it("answers a byte range with 206, and a range past the end with 416", async () => {
    const snapshots = new MemorySnapshots();
    const detail = await product(snapshots);
    const whole = await (await parquetDownload(new Request("https://open-data.pt/api/products/places.parquet"), detail, snapshots, describeSource)).arrayBuffer();
    const tail = await parquetDownload(new Request("https://open-data.pt/api/products/places.parquet", { headers: { Range: "bytes=-4" } }), detail, snapshots, describeSource);
    expect(tail.status).toBe(206);
    expect(tail.headers.get("Content-Range")).toBe(`bytes ${whole.byteLength - 4}-${whole.byteLength - 1}/${whole.byteLength}`);
    expect(new TextDecoder().decode(await tail.arrayBuffer())).toBe("PAR1");
    const reads = snapshots.reads;
    const past = await parquetDownload(
      new Request("https://open-data.pt/api/products/places.parquet", { headers: { Range: `bytes=${whole.byteLength}-` } }),
      detail,
      snapshots,
      describeSource,
    );
    expect(past.status).toBe(416);
    expect(past.headers.get("Content-Range")).toBe(`bytes */${whole.byteLength}`);
    // A 416 is answered from the stored size: the file itself is not read.
    expect(snapshots.reads).toBe(reads);
    expect(snapshots.uploads).toHaveLength(1);
  });
});
