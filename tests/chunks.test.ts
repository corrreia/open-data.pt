import { describe, expect, it } from "vitest";
import {
  buildChunks,
  chunkIndexFor,
  chunkListProblem,
  compareKeys,
  isChunkBoundary,
  parseChunkRows,
  regenerateChunks,
  writeChunk,
  type ChunkSink,
  type ServingRow,
} from "../apps/kernel/src/chunks";

describe("chunk list budget", () => {
  const chunk = (index: number) => ({
    key: `serving/feed_0123456789abcdef0123456789ab/some-product/chunks/${String(index).padStart(64, "0")}.json`,
    rows: 2048,
    first: `entity-${index}-first`,
    last: `entity-${index}-last`,
  });

  it("accepts the chunk list of a million-row product and refuses one too large to store as one value", () => {
    expect(
      chunkListProblem(
        Array.from({ length: 500 }, (_, index) => chunk(index)),
        "big",
      ),
    ).toBeUndefined();
    expect(
      chunkListProblem(
        Array.from({ length: 8_000 }, (_, index) => chunk(index)),
        "huge",
      ),
    ).toMatch(/huge lists 8000 chunks.*1048576-byte limit/);
  });
});

class MemorySink implements ChunkSink {
  readonly prefix = "serving/feed/product";
  readonly puts: string[] = [];
  readonly bodies = new Map<string, string>();
  constructor(readonly known: ReadonlySet<string> = new Set()) {}
  async put(key: string, body: string): Promise<void> {
    this.puts.push(key);
    this.bodies.set(key, body);
  }
}

function row(key: string, version = 0): ServingRow {
  return { key, json: JSON.stringify({ id: key, _hash: `h${version}`, value: version }) };
}

/** Deterministic pseudo-random numbers (mulberry32). */
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

const ALPHABET = ["a", "b", "z", "0", "9", "é", "ç", "\u{E000}", "\u{FFFD}", "😀", "𝔸", "-", "_"];

function randomKey(next: () => number): string {
  let key = "";
  const length = 1 + Math.floor(next() * 12);
  for (let index = 0; index < length; index += 1) key += ALPHABET[Math.floor(next() * ALPHABET.length)];
  return key;
}

function sortedRows(rows: Map<string, ServingRow>): ServingRow[] {
  return [...rows.values()].sort((left, right) => compareKeys(left.key, right.key));
}

function orderedSource(rows: ServingRow[]) {
  return (after: string | null, limit: number): ServingRow[] => {
    if (after === null) return rows.slice(0, limit);
    let low = 0;
    let high = rows.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (compareKeys(rows[middle]!.key, after) <= 0) low = middle + 1;
      else high = middle;
    }
    return rows.slice(low, low + limit);
  };
}

describe("key order", () => {
  it("matches SQLite's byte-wise UTF-8 order, including astral characters above U+E000", () => {
    const next = random(7);
    for (let index = 0; index < 5_000; index += 1) {
      const left = randomKey(next);
      const right = randomKey(next);
      const bytes = Math.sign(Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8")));
      expect(Math.sign(compareKeys(left, right)), `${left} vs ${right}`).toBe(bytes);
    }
    const privateUse = String.fromCodePoint(0xe000);
    const astral = String.fromCodePoint(0x1f600);
    expect(compareKeys(privateUse, astral)).toBeLessThan(0);
    // Plain UTF-16 comparison gets this pair backwards, which is why compareKeys exists.
    expect(privateUse < astral).toBe(false);
  });

  it("finds the chunk whose range holds a key", () => {
    const chunks = [
      { key: "a", rows: 1, first: "b", last: "c" },
      { key: "b", rows: 1, first: "d", last: "f" },
      { key: "c", rows: 1, first: "g", last: "h" },
    ];
    expect(chunkIndexFor(chunks, "a")).toBe(0);
    expect(chunkIndexFor(chunks, "c")).toBe(0);
    expect(chunkIndexFor(chunks, "d")).toBe(1);
    expect(chunkIndexFor(chunks, "e")).toBe(1);
    expect(chunkIndexFor(chunks, "zzz")).toBe(2);
  });
});

describe("content-addressed chunks", () => {
  it("round-trips rows exactly, one per line, and skips uploads of known chunks", async () => {
    const rows = ["a", "b", "c"].map((key) => row(key));
    const first = new MemorySink();
    const chunk = await writeChunk(first, rows);
    expect(first.puts).toEqual([chunk.key]);
    const body = first.bodies.get(chunk.key)!;
    expect(JSON.parse(body).rows).toHaveLength(3);
    expect(parseChunkRows(body)).toEqual(rows);
    const second = new MemorySink(new Set([chunk.key]));
    expect((await writeChunk(second, rows)).key).toBe(chunk.key);
    expect(second.puts).toEqual([]);
  });

  it("ends chunks where keys say so, so one insertion changes only nearby chunks", async () => {
    const keys = Array.from({ length: 20_000 }, (_, index) => `entity-${String(index).padStart(6, "0")}`);
    const before = await buildChunks(
      keys.map((key) => row(key)),
      new MemorySink(),
    );
    for (const chunk of before.slice(0, -1)) expect(isChunkBoundary(chunk.last) || chunk.rows >= 8192).toBe(true);
    const inserted = [...keys, "entity-010000-x"].sort(compareKeys);
    const after = await buildChunks(
      inserted.map((key) => row(key)),
      new MemorySink(),
    );
    const beforeKeys = new Set(before.map((chunk) => chunk.key));
    expect(after.filter((chunk) => !beforeKeys.has(chunk.key)).length).toBeLessThanOrEqual(2);
  });
});

describe("incremental regeneration", () => {
  it("always equals a full rebuild and uploads only chunks that did not exist", async () => {
    for (let seed = 1; seed <= 25; seed += 1) {
      const next = random(seed);
      const current = new Map<string, ServingRow>();
      const count = 2_000 + Math.floor(next() * 6_000);
      while (current.size < count) {
        const key = randomKey(next) + String(Math.floor(next() * 1_000_000));
        current.set(key, row(key));
      }
      const before = sortedRows(current);
      const previous = await buildChunks(before, new MemorySink());
      const changed = new Set<string>();
      // Always delete one chunk's first key and touch the last chunk.
      const firstKey = previous[Math.floor(next() * previous.length)]!.first;
      current.delete(firstKey);
      changed.add(firstKey);
      const lastKey = before.at(-1)!.key;
      current.set(lastKey, row(lastKey, 1));
      changed.add(lastKey);
      for (let edit = 0; edit < 1 + Math.floor(next() * 40); edit += 1) {
        const choice = next();
        if (choice < 0.35) {
          const key = randomKey(next) + String(Math.floor(next() * 1_000_000));
          current.set(key, row(key, 2));
          changed.add(key);
        } else {
          const existing = before[Math.floor(next() * before.length)]!.key;
          if (choice < 0.7) current.delete(existing);
          else current.set(existing, row(existing, 3));
          changed.add(existing);
        }
      }
      const after = sortedRows(current);
      const dirty = previous.map(() => false);
      for (const key of changed) dirty[chunkIndexFor(previous, key)] = true;
      const known = new Set(previous.map((chunk) => chunk.key));
      const sink = new MemorySink(known);
      const regenerated = await regenerateChunks(previous, dirty, orderedSource(after), sink, 7 + Math.floor(next() * 1500));
      const expected = await buildChunks(after, new MemorySink());
      expect(
        regenerated.map((chunk) => [chunk.key, chunk.rows]),
        `seed ${seed}`,
      ).toEqual(expected.map((chunk) => [chunk.key, chunk.rows]));
      // Exactly the chunks that did not exist before are uploaded: nothing reused is re-sent.
      expect(new Set(sink.puts), `seed ${seed}`).toEqual(new Set(expected.map((chunk) => chunk.key).filter((key) => !known.has(key))));
    }
  }, 120_000);

  it("rewrites exactly one chunk when one row changes in place", async () => {
    const rows = Array.from({ length: 10_000 }, (_, index) => row(`k${String(index).padStart(5, "0")}`));
    const previous = await buildChunks(rows, new MemorySink());
    const target = "k04321";
    const updated = rows.map((item) => (item.key === target ? row(target, 9) : item));
    const dirty = previous.map(() => false);
    dirty[chunkIndexFor(previous, target)] = true;
    const sink = new MemorySink(new Set(previous.map((chunk) => chunk.key)));
    await regenerateChunks(previous, dirty, orderedSource(updated), sink);
    expect(sink.puts).toHaveLength(1);
  });

  it("builds everything from scratch when there is no previous manifest", async () => {
    const rows = Array.from({ length: 3_000 }, (_, index) => row(`k${index}`)).sort((a, b) => compareKeys(a.key, b.key));
    const sink = new MemorySink();
    const chunks = await regenerateChunks([], [], orderedSource(rows), sink);
    expect(chunks.reduce((sum, chunk) => sum + chunk.rows, 0)).toBe(3_000);
    expect(sink.puts).toHaveLength(chunks.length);
  });
});
