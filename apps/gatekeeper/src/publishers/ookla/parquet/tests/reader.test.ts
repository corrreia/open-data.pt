import { describe, expect, it } from "vitest";
import { jsonAs, readFixtureBytes } from "#/tests/support";
import { GatekeeperError } from "#/index";
import {
  FOOTER_READ_BYTES,
  PORTUGAL,
  TILE_COLUMNS,
  covers,
  hybrid,
  quadkeyRanges,
  readLayout,
  rowsInRanges,
  snappyUncompress,
  tileCentre,
  type QuadkeyRow,
  type RangeReader,
  type ReadBudget,
} from "#/publishers/ookla/parquet/index";

/**
 * Two small files laid out the way Ookla's writers lay theirs out, built with pyarrow 25 from made-up tiles around
 * Portuguese and foreign places (Badajoz and Vigo among them), sorted by quadkey, each with the tiles that fall on
 * Portugal listed beside it:
 * - `tiles-arrow`: Arrow's defaults, as Q2 2026's file — eleven columns, three row groups of up to 500 rows, 2 KiB pages,
 *   RLE_DICTIONARY, page statistics, nulls in the loaded-latency columns;
 * - `tiles-legacy`: as 2019's files — seven columns, one row group, PLAIN_DICTIONARY with a quadkey dictionary that
 *   overflows into plain pages, and no quadkey statistics anywhere.
 */
const ARROW = readFixtureBytes(new URL("./fixtures/tiles-arrow.parquet", import.meta.url));
const LEGACY = readFixtureBytes(new URL("./fixtures/tiles-legacy.parquet", import.meta.url));
interface Expected {
  rows: number;
  portugal: (string | number | null)[][];
}
const ARROW_EXPECTED = jsonAs<Expected>(readFixtureBytes(new URL("./fixtures/tiles-arrow.expected.json", import.meta.url)));
const LEGACY_EXPECTED = jsonAs<Expected>(readFixtureBytes(new URL("./fixtures/tiles-legacy.expected.json", import.meta.url)));

/** Serves ranges of a file as a stream in chunks of `chunk` bytes, and records what was asked. */
function serve(file: Uint8Array, chunk = 64 * 1024) {
  const ranges: [number, number][] = [];
  let cancelled = 0;
  const read: RangeReader = async (start, length) => {
    ranges.push([start, length]);
    let offset = start;
    const end = start + length;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (offset >= end) {
          controller.close();
          return;
        }
        const next = Math.min(end, offset + chunk);
        controller.enqueue(file.slice(offset, next));
        offset = next;
      },
      cancel() {
        cancelled += 1;
      },
    });
  };
  return { read, ranges, cancelled: () => cancelled };
}

function budget(bytes = 64 * 1024 * 1024): ReadBudget {
  return { remainingBytes: bytes, maxRows: 10_000, requests: 0, bytes: 0 };
}

async function portugal(file: Uint8Array, read: RangeReader, cost: ReadBudget): Promise<QuadkeyRow[]> {
  const layout = await readLayout(read, file.byteLength, cost);
  const rows: QuadkeyRow[] = [];
  for await (const group of rowsInRanges(read, layout, PORTUGAL, TILE_COLUMNS, cost)) rows.push(...group);
  return rows;
}

function asLines(rows: QuadkeyRow[]): (string | number | null)[][] {
  return rows.map((row) => [row.quadkey, ...row.values]);
}

async function failure(promise: Promise<unknown>): Promise<GatekeeperError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof GatekeeperError) return error;
    throw error;
  }
  throw new Error("Expected a GatekeeperError");
}

describe("Ookla's Parquet tiles", () => {
  it("reads every Portuguese tile of Arrow's layout and nothing else, skipping what cannot hold one", async () => {
    const source = serve(ARROW);
    const cost = budget();
    const rows = await portugal(ARROW, source.read, cost);
    expect(asLines(rows)).toEqual(ARROW_EXPECTED.portugal);
    // Loaded latency is null where the file has none.
    expect(rows.some((row) => row.values[3] === null)).toBe(true);
    // The footer, then for each row group that can hold Portugal its quadkeys and seven columns: never the WKT or centroids.
    expect(source.ranges[0]).toEqual([ARROW.byteLength - Math.min(ARROW.byteLength, FOOTER_READ_BYTES), Math.min(ARROW.byteLength, FOOTER_READ_BYTES)]);
    expect((source.ranges.length - 1) % 8).toBe(0);
    expect(source.ranges.length - 1).toBeLessThan(3 * 8);
    expect(cost.requests).toBe(source.ranges.length);
    expect(cost.bytes).toBeLessThan(ARROW.byteLength);
  });

  it("reads the 2019 layout: one row group, plain dictionaries falling back to plain pages, no quadkey statistics", async () => {
    const source = serve(LEGACY);
    const rows = await portugal(LEGACY, source.read, budget());
    expect(asLines(rows)).toEqual(LEGACY_EXPECTED.portugal.map((line) => [...line.slice(0, 4), null, null, ...line.slice(6)]));
    // Its seven columns hold no loaded latency.
    expect(rows.every((row) => row.values[3] === null && row.values[4] === null)).toBe(true);
  });

  it("reads the same rows when the bytes arrive one at a time", async () => {
    const rows = await portugal(ARROW, serve(ARROW, 1).read, budget());
    expect(asLines(rows)).toEqual(ARROW_EXPECTED.portugal);
  });

  it("stops reading a column once past its last Portuguese row", async () => {
    // Paris and Sydney sort after every Portuguese tile: the chunks that hold both are left unread past Portugal.
    const source = serve(ARROW, 16);
    const cost = budget();
    await portugal(ARROW, source.read, cost);
    expect(source.cancelled()).toBeGreaterThan(0);
    expect(cost.bytes).toBeLessThan(source.ranges.reduce((total, [, length]) => total + length, 0));
  });

  it("fails once the reads pass the collection's byte budget", async () => {
    const error = await failure(portugal(ARROW, serve(ARROW).read, budget(FOOTER_READ_BYTES + 4096)));
    expect(error.code).toBe("response-too-large");
  });

  it("fails when more tiles fall on Portugal than any quarter has", async () => {
    const cost: ReadBudget = { ...budget(), maxRows: 100 };
    const error = await failure(portugal(ARROW, serve(ARROW).read, cost));
    expect(error.code).toBe("response-too-large");
  });

  it("refuses a file that does not end in a Parquet footer", async () => {
    const truncated = ARROW.slice(0, ARROW.byteLength - 1);
    expect((await failure(portugal(truncated, serve(truncated).read, budget()))).message).toMatch(/PAR1/);
    const lying = ARROW.slice();
    new DataView(lying.buffer).setUint32(lying.byteLength - 8, 0x7fffffff, true);
    expect((await failure(portugal(lying, serve(lying).read, budget()))).code).toBe("invalid-response");
    const garbled = ARROW.slice();
    const length = new DataView(garbled.buffer).getUint32(garbled.byteLength - 8, true);
    garbled.fill(0xff, garbled.byteLength - 8 - length, garbled.byteLength - 8);
    expect((await failure(portugal(garbled, serve(garbled).read, budget()))).message).toMatch(/footer is malformed/);
  });

  it("refuses a page whose compressed bytes are corrupt", async () => {
    const layout = await readLayout(serve(ARROW).read, ARROW.byteLength, budget());
    const quadkeys = layout.rowGroups.find((group) => (group.columns.get("quadkey")?.min ?? "") < "0313")?.columns.get("quadkey");
    if (!quadkeys) throw new Error("The fixture's first row group holds quadkeys");
    const corrupt = ARROW.slice();
    // Past the dictionary page's header, into its Snappy block.
    corrupt.fill(0xff, quadkeys.start + 40, quadkeys.start + quadkeys.length);
    const error = await failure(portugal(corrupt, serve(corrupt).read, budget()));
    expect(error.code).toBe("invalid-response");
  });
});

/** The zoom-16 quadkey of the tile a point falls in (Bing Maps Tile System). */
function at(longitude: number, latitude: number): string {
  const size = 2 ** 16;
  const x = Math.floor(((longitude + 180) / 360) * size);
  const radians = (latitude * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(radians) + 1 / Math.cos(radians)) / Math.PI) / 2) * size);
  let quadkey = "";
  for (let bit = 15; bit >= 0; bit -= 1) quadkey += String(((x >> bit) & 1) + 2 * ((y >> bit) & 1));
  return quadkey;
}

const LISBON = at(-9.14, 38.72);

describe("Portugal's quadkeys", () => {
  it("cover Portugal's places and leave Spain's out", () => {
    for (const [longitude, latitude] of [
      [-9.14, 38.72], // Lisbon
      [-7.163, 38.881], // Elvas, by Badajoz
      [-8.645, 42.03], // Valença, across the Minho from Tui
      [-7.417, 37.195], // Vila Real de Santo António, across the Guadiana from Ayamonte
      [-16.91, 32.65], // Funchal
      [-31.11, 39.7], // Corvo
      [-15.867, 30.142], // Selvagem Grande
    ])
      expect(covers(PORTUGAL, at(longitude!, latitude!))).toBe(true);
    for (const [longitude, latitude] of [
      [-6.97, 38.88], // Badajoz
      [-8.644, 42.048], // Tui
      [-7.405, 37.213], // Ayamonte
      [-3.7, 40.42], // Madrid
      [-16.25, 28.46], // Tenerife
    ])
      expect(covers(PORTUGAL, at(longitude!, latitude!))).toBe(false);
    expect(covers(PORTUGAL, "not a quadkey")).toBe(false);
  });

  it("merge touching prefixes, and place a tile's centre", () => {
    expect(quadkeyRanges(["01", "02", "1"])).toEqual([
      { low: "0100000000000000", high: "0233333333333333" },
      { low: "1000000000000000", high: "1333333333333333" },
    ]);
    expect(() => quadkeyRanges(["0", "01"])).toThrow(/Overlapping/);
    // Lisbon's tile, 0331102110020222, is a few hundred metres across.
    const centre = tileCentre(LISBON);
    expect(Math.abs(centre.latitude - 38.72)).toBeLessThan(0.005);
    expect(Math.abs(centre.longitude - -9.14)).toBeLessThan(0.005);
  });
});

describe("Parquet's encodings", () => {
  it("decode the RLE / bit-packed hybrid", () => {
    // A run of five 3s, then one bit-packed group of eight 2-bit values (0..3, 0..3).
    const bytes = new Uint8Array([10, 3, 3, 0b11100100, 0b11100100]);
    const output = new Uint32Array(13);
    hybrid(bytes, 0, bytes.byteLength, 2, output);
    expect([...output]).toEqual([3, 3, 3, 3, 3, 0, 1, 2, 3, 0, 1, 2, 3]);
    expect(() => hybrid(new Uint8Array([10]), 0, 1, 2, new Uint32Array(5))).toThrow(/RLE run/);
  });

  it("decompress Snappy, refusing a block that reaches outside itself", () => {
    // "abcabcabca": a 3-byte literal, then a copy of 7 bytes from 3 back.
    const block = new Uint8Array([10, 2 << 2, 97, 98, 99, 1 | ((7 - 4) << 2), 3]);
    expect(new TextDecoder().decode(snappyUncompress(block, 10))).toBe("abcabcabca");
    expect(() => snappyUncompress(block, 11)).toThrow(/not the 11/);
    expect(() => snappyUncompress(new Uint8Array([10, 2 << 2, 97, 98, 99, 1 | ((7 - 4) << 2), 9]), 10)).toThrow(/outside/);
  });
});
