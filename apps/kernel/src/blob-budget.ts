/**
 * Durable Object SQLite refuses any string, BLOB or row over 2 MB
 * (https://developers.cloudflare.com/durable-objects/platform/limits/).
 * Everything the kernel stores as one value is sized in UTF-8 bytes against
 * these budgets, never in JavaScript characters.
 */

/** Target size of a stored blob of rows: well under the limit, and a sensible Pipelines request (5 MB maximum). */
export const BLOB_BYTES = 900_000;

/**
 * The largest single record the kernel accepts, whatever a policy asks. A
 * record is stored whole in the entity index and in its history row, and JSON
 * escaping can grow it, so it stays at half the SQLite value limit.
 */
export const MAX_RECORD_BYTES = 1024 * 1024;

/**
 * The largest batch of rows staged to the runner in one call. It is one RPC
 * argument, and a Durable Object refuses a serialized call over 32 MiB, so a
 * batch counted only in rows fails as soon as a product's rows are large: a
 * record carrying its geometry runs to thousands of times one carrying a name
 * and a code, and two thousand of them came to 37 MB. A quarter of the limit
 * leaves room for the call around them and for a row far above the average.
 */
export const STAGE_BYTES = 8 * 1024 * 1024;

/**
 * How many bytes of one copy of a product in-memory comparison may hold before
 * the product is given to SQLite instead.
 *
 * The small path keeps three copies at once: the rows coming in, the rows
 * currently served, and the merge of the two. A Worker has 128 MiB for all of
 * it and for everything else in the isolate, so one copy has to sit well under
 * a third. Counting rows cannot do this job: three thousand parish boundaries
 * are 122 MB where twenty thousand names and codes are under two, and it was a
 * row count alone that let the parishes and the national road network run the
 * isolate out of memory.
 */
export const SMALL_PRODUCT_BYTES = 24 * 1024 * 1024;

/**
 * Bytes a JavaScript string costs per UTF-16 code unit, at worst.
 *
 * A string is held as one byte a code unit while every character fits Latin-1,
 * and as two the moment one does not — and it is the whole string that widens,
 * not the character. A row of Portuguese place names stays narrow; one em dash
 * or one Greek letter in a description doubles it. Since the count is taken
 * from lengths rather than from encoding every row, the bound assumes the
 * worse of the two.
 */
export const BYTES_PER_CODE_UNIT = 2;

/**
 * The largest chunk list a record product may have. It is one value in the
 * runner's and the Registry's SQLite and one RPC argument; at about 250 bytes
 * per chunk this is some 4,000 chunks, several million rows, and it leaves the
 * row room for the rest of the product's entry.
 */
export const MAX_CHUNK_LIST_BYTES = 1024 * 1024;

/** UTF-8 length of a string, without encoding it. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < text.length) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
}

/** One JSON array of serialized values, ready to store as a single SQLite value. */
export interface JsonArrayBlob {
  json: string;
  count: number;
  bytes: number;
}

/**
 * Group serialized JSON values into JSON arrays of at most `budget` UTF-8
 * bytes each. A blob is closed before a value would overflow it, so only a
 * single value larger than the budget makes a larger blob, alone.
 */
export function* jsonArrays(values: Iterable<string>, budget = BLOB_BYTES): Generator<JsonArrayBlob> {
  let part: string[] = [];
  let bytes = 2;
  for (const value of values) {
    const size = utf8Length(value) + 1;
    if (part.length > 0 && bytes + size > budget) {
      yield { json: `[${part.join(",")}]`, count: part.length, bytes };
      part = [];
      bytes = 2;
    }
    part.push(value);
    bytes += size;
  }
  if (part.length > 0) yield { json: `[${part.join(",")}]`, count: part.length, bytes };
}
