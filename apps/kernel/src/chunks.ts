import { isJsonString, parseJson, type JsonValue } from "@open-data-pt/gatekeeper-shared";

import { MAX_CHUNK_LIST_BYTES, utf8Length } from "./blob-budget";
import { hash32, sha256Hex } from "./hash";

/**
 * Current record products are served from immutable, content-addressed chunks,
 * listed in order on the product's index entry. Rows are ordered by entity key
 * and a chunk ends where a key's hash says so (content-defined boundaries), so
 * inserting or deleting one entity changes only the chunk around it. Identical
 * chunks keep their key and are never uploaded twice.
 */
export const CHUNK_LIMITS = { targetRows: 2048, maxRows: 8192, maxChars: 2 * 1024 * 1024 } as const;

export interface ManifestChunk {
  key: string;
  rows: number;
  first: string;
  last: string;
}

/** Why a chunk list cannot be stored and published, or undefined when it fits. */
export function chunkListProblem(chunks: readonly ManifestChunk[], slug: string): string | undefined {
  const bytes = utf8Length(JSON.stringify(chunks));
  if (bytes <= MAX_CHUNK_LIST_BYTES) return undefined;
  return `Product ${slug} lists ${chunks.length} chunks in ${bytes} bytes, over the ${MAX_CHUNK_LIST_BYTES}-byte limit for one stored value`;
}

/** One served row: its entity key and its serialized JSON (with `id`, `_hash`, `_time`). */
export interface ServingRow {
  key: string;
  json: string;
}

export interface ChunkObject {
  rows: Array<import("@open-data-pt/gatekeeper-shared").JsonObject>;
}

export function isChunkBoundary(key: string): boolean {
  return hash32(key) % CHUNK_LIMITS.targetRows === 0;
}

/** Where chunk bytes go; `known` keys already exist and are not uploaded again. */
export interface ChunkSink {
  prefix: string;
  known: ReadonlySet<string>;
  put(key: string, body: string): Promise<void>;
}

/**
 * A chunk is valid JSON with exactly one row per line, so unchanged rows can be
 * reused byte for byte by splitting lines instead of re-serializing them.
 */
export async function writeChunk(sink: ChunkSink, rows: ServingRow[]): Promise<ManifestChunk> {
  let body = '{"rows":[\n';
  for (let index = 0; index < rows.length; index += 1) {
    if (index > 0) body += ",\n";
    body += rows[index]!.json;
  }
  body += "\n]}";
  const key = `${sink.prefix}/chunks/${await sha256Hex(body)}.json`;
  if (!sink.known.has(key)) await sink.put(key, body);
  return { key, rows: rows.length, first: rows[0]!.key, last: rows.at(-1)!.key };
}

/** The rows of a chunk body, each with its exact JSON, by splitting lines instead of parsing the whole body. */
export function parseChunkRows(body: string): ServingRow[] {
  const rows: ServingRow[] = [];
  const lines = body.split("\n");
  for (let index = 1; index < lines.length - 1; index += 1) {
    let line = lines[index]!;
    if (line.endsWith(",")) line = line.slice(0, -1);
    if (!line) continue;
    rows.push({ key: rowKey(line), json: line });
  }
  return rows;
}

function rowKey(json: string): string {
  return servedIdentity(json).key;
}

const HASH_MARK = ',"_hash":"';
const ID_MARK = '"id":';
const QUOTE = 34;

/** Which entity a served row is, and the semantic hash it was served with. */
export interface ServedIdentity {
  key: string;
  hash: string;
}

/**
 * The key and hash a served row carries, read without parsing the whole row.
 * servingJson writes `id`, `_hash` and `_time` after every payload field, and
 * `_time` holds only fixed keys, so the last `_hash` and the `id` just before it
 * are the row's own whatever the payload contains. Anything else is parsed.
 */
export function servedIdentity(json: string): ServedIdentity {
  const hashAt = json.lastIndexOf(HASH_MARK);
  const idAt = hashAt < 0 ? -1 : json.lastIndexOf(ID_MARK, hashAt);
  const hashEnd = hashAt < 0 ? -1 : json.indexOf('"', hashAt + HASH_MARK.length);
  if (idAt >= 0 && hashEnd > 0 && json.charCodeAt(idAt + ID_MARK.length) === QUOTE && json.charCodeAt(hashAt - 1) === QUOTE) {
    let key: JsonValue | undefined;
    try {
      key = parseJson(json.slice(idAt + ID_MARK.length, hashAt));
    } catch {
      /* not the layout servingJson writes: parse it whole */
    }
    if (isJsonString(key)) return { key, hash: json.slice(hashAt + HASH_MARK.length, hashEnd) };
  }
  // SAFETY: chunk rows are written only by servingJson as JSON objects with a string `id` and `_hash`.
  const row = JSON.parse(json) as { id: string; _hash: string };
  return { key: row.id, hash: row._hash };
}

/** Accumulates key-ordered rows and closes chunks at content-defined boundaries. */
export class ChunkWriter {
  private rows: ServingRow[] = [];
  private chars = 0;
  readonly chunks: ManifestChunk[] = [];

  constructor(private readonly sink: ChunkSink) {}

  /** Returns true when this row closed a chunk. */
  async push(row: ServingRow): Promise<boolean> {
    this.rows.push(row);
    this.chars += row.json.length;
    if (isChunkBoundary(row.key) || this.rows.length >= CHUNK_LIMITS.maxRows || this.chars >= CHUNK_LIMITS.maxChars) {
      await this.close();
      return true;
    }
    return false;
  }

  async close(): Promise<void> {
    if (this.rows.length === 0) return;
    const rows = this.rows;
    this.rows = [];
    this.chars = 0;
    this.chunks.push(await writeChunk(this.sink, rows));
  }
}

/** Build every chunk from rows already sorted by key. */
export async function buildChunks(rows: Iterable<ServingRow>, sink: ChunkSink): Promise<ManifestChunk[]> {
  const writer = new ChunkWriter(sink);
  for (const row of rows) await writer.push(row);
  await writer.close();
  return writer.chunks;
}

/**
 * Order keys by Unicode code point, which is SQLite's BINARY (UTF-8 byte)
 * order. Plain `<` compares UTF-16 units and disagrees for astral characters.
 */
export function compareKeys(left: string, right: string): number {
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.charCodeAt(index);
    const b = right.charCodeAt(index);
    if (a === b) continue;
    const aSurrogate = a >= 0xd800 && a <= 0xdfff;
    const bSurrogate = b >= 0xd800 && b <= 0xdfff;
    if (aSurrogate && !bSurrogate && b >= 0xe000) return 1;
    if (bSurrogate && !aSurrogate && a >= 0xe000) return -1;
    return a - b;
  }
  return left.length - right.length;
}

/** Index of the chunk whose key range holds `key`: the last chunk starting at or before it. */
export function chunkIndexFor(chunks: readonly ManifestChunk[], key: string): number {
  let low = 0;
  let high = chunks.length - 1;
  let found = 0;
  while (low <= high) {
    const middle = (low + high) >> 1;
    if (compareKeys(chunks[middle]!.first, key) <= 0) {
      found = middle;
      low = middle + 1;
    } else high = middle - 1;
  }
  return found;
}

/** Key-ordered rows strictly after `after` (or from the start when null), at most `limit`. */
export type OrderedRows = (after: string | null, limit: number) => ServingRow[] | Promise<ServingRow[]>;

/**
 * Rebuild only the chunks whose key ranges changed. Clean chunks are reused as
 * soon as a regenerated run closes exactly where the next clean chunk starts;
 * from there on the old chunks are, by construction, what a full rebuild would
 * produce. With no previous chunks this is a full rebuild.
 */
export async function regenerateChunks(
  previous: readonly ManifestChunk[],
  dirty: readonly boolean[],
  rows: OrderedRows,
  sink: ChunkSink,
  pageSize = 1000,
): Promise<ManifestChunk[]> {
  if (previous.length === 0) return rebuildFrom(null, rows, sink, pageSize, () => undefined);
  const output: ManifestChunk[] = [];
  let index = 0;
  while (index < previous.length) {
    if (!dirty[index]) {
      output.push(previous[index]!);
      index += 1;
      continue;
    }
    const after = output.at(-1)?.last ?? null;
    let resumeAt = previous.length;
    const chunks = await rebuildFrom(after, rows, sink, pageSize, (lastKey, nextKey) => {
      if (nextKey === undefined) return undefined;
      // The first old chunk starting after what was just emitted.
      let candidate = index;
      while (candidate < previous.length && compareKeys(previous[candidate]!.first, lastKey) <= 0) candidate += 1;
      if (candidate < previous.length && !dirty[candidate] && previous[candidate]!.first === nextKey) {
        resumeAt = candidate;
        return candidate;
      }
      return undefined;
    });
    output.push(...chunks);
    index = resumeAt;
  }
  return output;
}

/**
 * Emit chunks from `after` onwards. After each closed chunk `resync` sees the
 * last emitted key and the next key in order; returning a number stops here.
 */
async function rebuildFrom(
  after: string | null,
  rows: OrderedRows,
  sink: ChunkSink,
  pageSize: number,
  resync: (lastKey: string, nextKey: string | undefined) => number | undefined,
): Promise<ManifestChunk[]> {
  const writer = new ChunkWriter(sink);
  let cursor = after;
  let page = await rows(cursor, pageSize);
  let position = 0;
  while (position < page.length) {
    const row = page[position]!;
    position += 1;
    const closed = await writer.push(row);
    if (position >= page.length) {
      cursor = row.key;
      page = await rows(cursor, pageSize);
      position = 0;
    }
    if (closed && resync(row.key, page[position]?.key) !== undefined) return writer.chunks;
  }
  await writer.close();
  return writer.chunks;
}
