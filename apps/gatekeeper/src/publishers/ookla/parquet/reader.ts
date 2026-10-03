import { GatekeeperError } from "#/index";
import { beyond, covers, overlaps, type QuadkeyRange } from "./quadkeys";
import { SnappyInvalid, snappyUncompress } from "./snappy";
import { ThriftInvalid, ThriftStruct, ThriftUnderflow, readStruct } from "./thrift";

/*
 * A Parquet reader for one question: which rows of a file sorted by quadkey
 * fall in a set of quadkey ranges, and what a few of their columns say. It
 * never holds a file, a column chunk or a row group: it reads the footer, picks
 * the row groups whose quadkey statistics meet the ranges, and streams each
 * column chunk it needs, page by page, decompressing only the pages that hold
 * a wanted row and dropping the rest as their bytes arrive. Once past the last
 * wanted row it stops reading. What it holds at once is a page or two and the
 * wanted rows of one row group.
 *
 * It reads what Ookla's writers write (Apache Arrow's Parquet writer and Amazon
 * Redshift's UNLOAD): flat columns, version 1 data pages, plain and dictionary
 * encodings, Snappy or no compression. Anything else is refused, not guessed at.
 */

/** Reads `length` bytes of the file from `start`. The caller may cancel the stream once it has what it needs. */
export type RangeReader = (start: number, length: number) => Promise<ReadableStream<Uint8Array>>;

/** One column chunk the footer locates. */
export interface ColumnChunk {
  name: string;
  /** Parquet's physical type: 1 INT32, 2 INT64, 4 FLOAT, 5 DOUBLE, 6 BYTE_ARRAY. */
  type: number;
  optional: boolean;
  /** 0 uncompressed, 1 Snappy. */
  codec: number;
  start: number;
  length: number;
  /** The chunk's statistics, as text: the quadkeys it starts and ends with. */
  min?: string;
  max?: string;
}

/** One row group: how many rows it holds and where each of its columns is. */
export interface RowGroup {
  rows: number;
  columns: ReadonlyMap<string, ColumnChunk>;
}

export interface ParquetLayout {
  rows: number;
  rowGroups: readonly RowGroup[];
}

/** What one read may cost, and what it has cost so far. */
export interface ReadBudget {
  /** Source bytes still allowed, across every request of the read. */
  remainingBytes: number;
  /** Rows the ranges may select from the whole file. */
  maxRows: number;
  /** Requests made, and bytes read. */
  requests: number;
  bytes: number;
}

/** A selected row: its quadkey, and each wanted column's value, null where the file has none. */
export interface QuadkeyRow {
  quadkey: string;
  values: (number | null)[];
}

/** What the end of a file reads at once: every footer Ookla has written fits in it many times over. */
export const FOOTER_READ_BYTES = 64 * 1024;
/** A footer longer than this is not one of these files. */
const MAX_FOOTER_BYTES = 4 * 1024 * 1024;
/** Page headers are tens of bytes, a few hundred with statistics. */
const MAX_PAGE_HEADER_BYTES = 64 * 1024;
/** The largest page Ookla writes is about 1 MiB uncompressed. */
const MAX_PAGE_BYTES = 16 * 1024 * 1024;
const MAX_PAGE_VALUES = 4_000_000;

const MAGIC = [0x50, 0x41, 0x52, 0x31];

const PAGE = { data: 0, dictionary: 2, dataV2: 3 } as const;
const ENCODING = { plain: 0, plainDictionary: 2, rle: 3, rleDictionary: 8 } as const;
const TYPE = { int32: 1, int64: 2, float: 4, double: 5, byteArray: 6 } as const;
const CODEC = { uncompressed: 0, snappy: 1 } as const;

function invalid(message: string): GatekeeperError {
  return new GatekeeperError(`Parquet: ${message}`, "invalid-response");
}

/** Reads a struct, turning the Thrift reader's own failures into the Gatekeeper's. */
function struct(bytes: Uint8Array, what: string): ThriftStruct {
  try {
    return readStruct(bytes).struct;
  } catch (error) {
    if (error instanceof ThriftUnderflow || error instanceof ThriftInvalid) throw invalid(`${what} is malformed: ${error.message}`);
    throw error;
  }
}

/** How long the footer's metadata is, from the last eight bytes of the file. */
export function footerLength(tail: Uint8Array): number {
  if (tail.byteLength < 12) throw invalid("the file is too short to be Parquet");
  for (let index = 0; index < 4; index += 1) if (tail[tail.byteLength - 4 + index] !== MAGIC[index]) throw invalid("the file does not end in PAR1");
  const length = new DataView(tail.buffer, tail.byteOffset + tail.byteLength - 8, 4).getUint32(0, true);
  if (length === 0 || length > MAX_FOOTER_BYTES) throw invalid(`a footer of ${length} bytes is not one this reader takes`);
  return length;
}

/**
 * The layout the footer describes, for a file of `size` bytes: every row
 * group, and where each of its flat columns' chunks lies before the footer.
 */
export function parseLayout(metadata: Uint8Array, size: number): ParquetLayout {
  const dataEnd = size - 8 - metadata.byteLength;
  const file = struct(metadata, "the footer");
  try {
    const schema = file.structs(2);
    const root = schema[0];
    const leaves = schema.slice(1);
    if (!root || root.integer(5) !== leaves.length || leaves.length === 0) throw invalid("only flat schemas are read");
    const fields = leaves.map((element) => {
      if (element.has(5)) throw invalid("nested columns are not read");
      const repetition = element.requiredInteger(3);
      if (repetition === 2) throw invalid("repeated columns are not read");
      return { name: element.string(4) ?? "", type: element.integer(1) ?? -1, optional: repetition === 1 };
    });
    const rows = file.requiredInteger(3);
    const rowGroups: RowGroup[] = [];
    let total = 0;
    for (const group of file.structs(4)) {
      const chunks = group.structs(1);
      if (chunks.length !== fields.length) throw invalid("a row group does not hold every column");
      const columns = new Map<string, ColumnChunk>();
      chunks.forEach((chunk, index) => {
        const field = fields[index]!;
        if (chunk.has(1)) throw invalid("columns in other files are not read");
        const meta = chunk.struct(3);
        if (!meta) throw invalid("a column chunk has no metadata");
        const path = meta.list(3);
        const name = path.length === 1 && path[0] instanceof Uint8Array ? new TextDecoder().decode(path[0]) : "";
        if (name !== field.name || meta.requiredInteger(1) !== field.type) throw invalid(`column ${index} does not match the schema`);
        const dataOffset = meta.requiredInteger(9);
        const dictionaryOffset = meta.integer(11);
        // Some writers have stated a dictionary offset of 0 for chunks without one; a dictionary page is always before the data.
        const start = dictionaryOffset !== undefined && dictionaryOffset >= 4 && dictionaryOffset < dataOffset ? dictionaryOffset : dataOffset;
        const length = meta.requiredInteger(7);
        if (!Number.isSafeInteger(start) || !Number.isSafeInteger(length) || start < 4 || length <= 0 || start + length > dataEnd)
          throw invalid(`column ${field.name} lies outside the file`);
        const located: ColumnChunk = { name: field.name, type: field.type, optional: field.optional, codec: meta.requiredInteger(4), start, length };
        const statistics = meta.struct(12);
        const min = statistics?.binary(6) ?? statistics?.binary(2);
        const max = statistics?.binary(5) ?? statistics?.binary(1);
        if (field.type === TYPE.byteArray && min && max) {
          located.min = latin1(min, 0, min.byteLength);
          located.max = latin1(max, 0, max.byteLength);
        }
        columns.set(field.name, located);
      });
      const groupRows = group.requiredInteger(3);
      if (!Number.isSafeInteger(groupRows) || groupRows < 0) throw invalid("a row group states no row count");
      total += groupRows;
      rowGroups.push({ rows: groupRows, columns });
    }
    if (total !== rows) throw invalid(`the row groups hold ${total} rows, not the ${rows} the file states`);
    return { rows, rowGroups };
  } catch (error) {
    if (error instanceof ThriftInvalid) throw invalid(`the footer is malformed: ${error.message}`);
    throw error;
  }
}

/** Reads the footer: the file's last 64 KiB in one request, and the rest of a longer footer in a second. */
export async function readLayout(read: RangeReader, size: number, budget: ReadBudget): Promise<ParquetLayout> {
  if (!Number.isSafeInteger(size) || size < 12) throw invalid("the file is too short to be Parquet");
  const tailStart = Math.max(0, size - FOOTER_READ_BYTES);
  const tail = await readAll(read, tailStart, size - tailStart, budget);
  const length = footerLength(tail);
  if (length + 8 > size - 4) throw invalid("the footer is longer than the file");
  let metadata: Uint8Array;
  if (length + 8 <= tail.byteLength) metadata = tail.subarray(tail.byteLength - 8 - length, tail.byteLength - 8);
  else {
    const start = size - 8 - length;
    const head = await readAll(read, start, tailStart - start, budget);
    metadata = new Uint8Array(length);
    metadata.set(head, 0);
    metadata.set(tail.subarray(0, tail.byteLength - 8), head.byteLength);
  }
  return parseLayout(metadata, size);
}

/** A whole range, buffered: only for the footer, which is bounded above. */
async function readAll(read: RangeReader, start: number, length: number, budget: ReadBudget): Promise<Uint8Array> {
  const queue = new ByteQueue(await open(read, start, length, budget));
  await queue.fill(length);
  if (queue.available < length) throw invalid("the file ended early");
  return queue.take(length);
}

/** Opens one range of the file, counting the request and every byte that arrives against the budget. */
async function open(read: RangeReader, start: number, length: number, budget: ReadBudget): Promise<ReadableStream<Uint8Array>> {
  budget.requests += 1;
  const body = await read(start, length);
  let seen = 0;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        seen += chunk.byteLength;
        budget.bytes += chunk.byteLength;
        budget.remainingBytes -= chunk.byteLength;
        if (seen > length) controller.error(invalid(`a range of ${length} bytes returned more`));
        else if (budget.remainingBytes < 0) controller.error(new GatekeeperError("The Parquet reads exceeded this collection's source budget", "response-too-large"));
        else controller.enqueue(chunk);
      },
    }),
  );
}

/**
 * Every row of the file whose quadkey falls in `ranges`, with the values of
 * `columns` (null where a row has none, or the file has no such column), in
 * file order, one row group's worth at a time.
 */
export async function* rowsInRanges(
  read: RangeReader,
  layout: ParquetLayout,
  ranges: readonly QuadkeyRange[],
  columns: readonly string[],
  budget: ReadBudget,
): AsyncGenerator<QuadkeyRow[]> {
  let selectedRows = 0;
  for (const group of layout.rowGroups) {
    const quadkeys = group.columns.get("quadkey");
    if (!quadkeys || quadkeys.type !== TYPE.byteArray) throw invalid("the file has no quadkey column");
    if (quadkeys.min !== undefined && quadkeys.max !== undefined && !overlaps(ranges, quadkeys.min, quadkeys.max)) continue;
    const selection = await selectRows(read, quadkeys, group.rows, ranges, budget);
    if (selection.rows.length === 0) continue;
    selectedRows += selection.rows.length;
    if (selectedRows > budget.maxRows) throw new GatekeeperError(`More than ${budget.maxRows} rows fall in the ranges`, "response-too-large");
    const values: Float64Array[] = [];
    for (const name of columns) {
      const chunk = group.columns.get(name);
      values.push(chunk ? await readValues(read, chunk, selection.rows, budget) : new Float64Array(selection.rows.length).fill(Number.NaN));
    }
    yield selection.keys.map((quadkey, index) => ({ quadkey, values: values.map((column) => (Number.isNaN(column[index]!) ? null : column[index]!)) }));
  }
}

/** The rows of one row group whose quadkeys fall in the ranges: their indices in the group, in order, and their quadkeys. */
interface Selection {
  rows: number[];
  keys: string[];
}

async function selectRows(read: RangeReader, chunk: ColumnChunk, groupRows: number, ranges: readonly QuadkeyRange[], budget: ReadBudget): Promise<Selection> {
  const pages = new ChunkPages(await open(read, chunk.start, chunk.length, budget), chunk.length);
  const rows: number[] = [];
  const keys: string[] = [];
  let dictionary: Page | undefined;
  let decodedDictionary: string[] | undefined;
  let row = 0;
  // Whether every page so far began after the one before ended: only then does a page past the ranges end the search.
  let ordered = true;
  let previousMax = "";
  let past = false;
  try {
    for (let page = await pages.next(); page; page = await pages.next()) {
      if (page.type === PAGE.dictionary) {
        dictionary = { ...page, payload: await pages.payload(page) };
        decodedDictionary = undefined;
        continue;
      }
      dataPage(page);
      if (page.min !== undefined && page.max !== undefined) {
        if (page.min < previousMax) ordered = false;
        previousMax = page.max;
        if (!overlaps(ranges, page.min, page.max)) {
          // Sorted, and already past the last range: the rest of the chunk is never read.
          if (ordered && beyond(ranges, page.min)) {
            past = true;
            break;
          }
          await pages.skip(page);
          row += page.values;
          continue;
        }
      }
      if (page.encoding !== ENCODING.plain) decodedDictionary ??= stringDictionary(dictionary, chunk);
      const decoded = decodePage({ ...page, payload: await pages.payload(page) }, chunk);
      const strings = decodeStrings(decoded, page, decodedDictionary);
      let value = 0;
      for (let index = 0; index < page.values; index += 1) {
        if (decoded.defined && decoded.defined[index] === 0) continue;
        const quadkey = strings[value]!;
        value += 1;
        if (covers(ranges, quadkey)) {
          rows.push(row + index);
          keys.push(quadkey);
        }
      }
      row += page.values;
    }
    if (!past && row !== groupRows) throw invalid(`column quadkey holds ${row} rows of a row group of ${groupRows}`);
    return { rows, keys };
  } finally {
    await pages.close();
  }
}

/** One numeric column's values at the selected rows (NaN where a row has none), reading no further than the last of them. */
async function readValues(read: RangeReader, chunk: ColumnChunk, rows: readonly number[], budget: ReadBudget): Promise<Float64Array> {
  if (chunk.type !== TYPE.int32 && chunk.type !== TYPE.int64 && chunk.type !== TYPE.float && chunk.type !== TYPE.double) throw invalid(`column ${chunk.name} is not numeric`);
  const values = new Float64Array(rows.length).fill(Number.NaN);
  const last = rows.at(-1);
  if (last === undefined) return values;
  const pages = new ChunkPages(await open(read, chunk.start, chunk.length, budget), chunk.length);
  let dictionary: Page | undefined;
  let decodedDictionary: Float64Array | undefined;
  let row = 0;
  let next = 0;
  try {
    for (let page = await pages.next(); page && row <= last; page = await pages.next()) {
      if (page.type === PAGE.dictionary) {
        dictionary = { ...page, payload: await pages.payload(page) };
        decodedDictionary = undefined;
        continue;
      }
      dataPage(page);
      const end = row + page.values;
      if (rows[next]! >= end) {
        await pages.skip(page);
        row = end;
        continue;
      }
      if (page.encoding !== ENCODING.plain) decodedDictionary ??= numberDictionary(dictionary, chunk);
      const decoded = decodePage({ ...page, payload: await pages.payload(page) }, chunk);
      const numbers = decodeNumbers(decoded, page, chunk, decodedDictionary);
      // Where each row's value sits among the page's non-null values.
      let value = 0;
      let index = 0;
      while (next < rows.length && rows[next]! < end) {
        const target = rows[next]! - row;
        for (; index < target; index += 1) if (!decoded.defined || decoded.defined[index] === 1) value += 1;
        if (!decoded.defined || decoded.defined[target] === 1) values[next] = numbers[value]!;
        next += 1;
      }
      row = end;
    }
    if (next < rows.length) throw invalid(`column ${chunk.name} ends before the rows it should hold`);
    return values;
  } finally {
    await pages.close();
  }
}

/** A page header, with what this reader uses of it. */
interface PageHeader {
  type: number;
  compressed: number;
  uncompressed: number;
  /** Values in the page, nulls included; for a dictionary page, its entries. */
  values: number;
  encoding: number;
  min?: string;
  max?: string;
}

interface Page extends PageHeader {
  payload: Uint8Array;
}

function pageHeader(header: ThriftStruct): PageHeader {
  const type = header.requiredInteger(1);
  const uncompressed = header.requiredInteger(2);
  const compressed = header.requiredInteger(3);
  if (compressed < 0 || uncompressed < 0 || compressed > MAX_PAGE_BYTES || uncompressed > MAX_PAGE_BYTES) throw invalid(`a page of ${uncompressed} bytes is not read`);
  const detail = header.struct(type === PAGE.dictionary ? 7 : type === PAGE.dataV2 ? 8 : 5);
  const page: PageHeader = { type, compressed, uncompressed, values: 0, encoding: -1 };
  if (type !== PAGE.data && type !== PAGE.dictionary) return page;
  if (!detail) throw invalid("a page header has no detail");
  page.values = detail.requiredInteger(1);
  page.encoding = detail.requiredInteger(2);
  if (page.values < 0 || page.values > MAX_PAGE_VALUES) throw invalid(`a page of ${page.values} values is not read`);
  if (type === PAGE.data && (detail.integer(3) ?? ENCODING.rle) !== ENCODING.rle) throw invalid("definition levels are not RLE");
  const statistics = detail.struct(5);
  const min = statistics?.binary(6) ?? statistics?.binary(2);
  const max = statistics?.binary(5) ?? statistics?.binary(1);
  if (type === PAGE.data && min && max) {
    page.min = latin1(min, 0, min.byteLength);
    page.max = latin1(max, 0, max.byteLength);
  }
  return page;
}

/** Only version 1 data pages are read: what Arrow writes by default and Redshift always has. */
function dataPage(page: PageHeader): void {
  if (page.type === PAGE.dataV2) throw invalid("version 2 data pages are not read");
  if (page.type !== PAGE.data) throw invalid(`page type ${page.type} is not read`);
}

/** A page's bytes, decompressed, with where its values begin and which of its rows have one. */
interface DecodedPage {
  bytes: Uint8Array;
  /** Where the values start, after the definition levels. */
  offset: number;
  /** 1 where a row has a value; absent when every row has one. */
  defined: Uint8Array | undefined;
  /** How many values the page encodes. */
  count: number;
}

function decodePage(page: Page, chunk: ColumnChunk): DecodedPage {
  const bytes = decompress(page, chunk);
  if (page.type === PAGE.dictionary || !chunk.optional) return { bytes, offset: 0, defined: undefined, count: page.values };
  if (bytes.byteLength < 4) throw invalid(`a page of ${chunk.name} has no definition levels`);
  const length = new DataView(bytes.buffer, bytes.byteOffset, 4).getUint32(0, true);
  if (4 + length > bytes.byteLength) throw invalid(`the definition levels of ${chunk.name} overrun their page`);
  const defined = new Uint8Array(page.values);
  hybrid(bytes, 4, 4 + length, 1, defined);
  let count = 0;
  for (let index = 0; index < defined.length; index += 1) count += defined[index]!;
  return { bytes, offset: 4 + length, defined, count };
}

function decompress(page: Page, chunk: ColumnChunk): Uint8Array {
  if (chunk.codec === CODEC.uncompressed) {
    if (page.payload.byteLength !== page.uncompressed) throw invalid(`an uncompressed page of ${chunk.name} is not the size it states`);
    return page.payload;
  }
  if (chunk.codec !== CODEC.snappy) throw invalid(`column ${chunk.name} is compressed with codec ${chunk.codec}, which is not read`);
  try {
    return snappyUncompress(page.payload, page.uncompressed);
  } catch (error) {
    if (error instanceof SnappyInvalid) throw invalid(`a page of ${chunk.name}: ${error.message}`);
    throw error;
  }
}

function stringDictionary(page: Page | undefined, chunk: ColumnChunk): string[] {
  if (!page) throw invalid(`a page of ${chunk.name} refers to a dictionary the chunk does not have`);
  return plainStrings(decodePage(page, chunk), page.values);
}

function numberDictionary(page: Page | undefined, chunk: ColumnChunk): Float64Array {
  if (!page) throw invalid(`a page of ${chunk.name} refers to a dictionary the chunk does not have`);
  return plainNumbers(decodePage(page, chunk), page.values, chunk);
}

function decodeStrings(decoded: DecodedPage, page: PageHeader, dictionary: string[] | undefined): string[] {
  if (page.encoding === ENCODING.plain) return plainStrings(decoded, decoded.count);
  if (page.encoding !== ENCODING.plainDictionary && page.encoding !== ENCODING.rleDictionary) throw invalid(`encoding ${page.encoding} is not read`);
  const indices = dictionaryIndices(decoded);
  return Array.from(indices, (index) => {
    const value = dictionary?.[index];
    if (value === undefined) throw invalid("a dictionary index is out of range");
    return value;
  });
}

function decodeNumbers(decoded: DecodedPage, page: PageHeader, chunk: ColumnChunk, dictionary: Float64Array | undefined): Float64Array {
  if (page.encoding === ENCODING.plain) return plainNumbers(decoded, decoded.count, chunk);
  if (page.encoding !== ENCODING.plainDictionary && page.encoding !== ENCODING.rleDictionary) throw invalid(`encoding ${page.encoding} is not read`);
  const indices = dictionaryIndices(decoded);
  const numbers = new Float64Array(indices.length);
  for (let index = 0; index < indices.length; index += 1) {
    const entry = indices[index]!;
    if (!dictionary || entry >= dictionary.length) throw invalid("a dictionary index is out of range");
    numbers[index] = dictionary[entry]!;
  }
  return numbers;
}

function dictionaryIndices(decoded: DecodedPage): Uint32Array {
  const indices = new Uint32Array(decoded.count);
  if (decoded.count === 0) return indices;
  if (decoded.offset >= decoded.bytes.byteLength) throw invalid("dictionary indices are missing");
  const width = decoded.bytes[decoded.offset]!;
  if (width > 32) throw invalid(`a dictionary index width of ${width} bits`);
  hybrid(decoded.bytes, decoded.offset + 1, decoded.bytes.byteLength, width, indices);
  return indices;
}

function plainStrings(decoded: DecodedPage, count: number): string[] {
  const { bytes } = decoded;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const strings: string[] = [];
  let offset = decoded.offset;
  for (let index = 0; index < count; index += 1) {
    if (offset + 4 > bytes.byteLength) throw invalid("a string runs past its page");
    const length = view.getUint32(offset, true);
    offset += 4;
    if (offset + length > bytes.byteLength) throw invalid("a string runs past its page");
    strings.push(latin1(bytes, offset, offset + length));
    offset += length;
  }
  return strings;
}

function plainNumbers(decoded: DecodedPage, count: number, chunk: ColumnChunk): Float64Array {
  const { bytes } = decoded;
  const width = chunk.type === TYPE.int32 || chunk.type === TYPE.float ? 4 : 8;
  if (decoded.offset + count * width > bytes.byteLength) throw invalid(`the values of ${chunk.name} run past their page`);
  const view = new DataView(bytes.buffer, bytes.byteOffset + decoded.offset, count * width);
  const numbers = new Float64Array(count);
  for (let index = 0; index < count; index += 1) {
    const at = index * width;
    if (chunk.type === TYPE.int32) numbers[index] = view.getInt32(at, true);
    else if (chunk.type === TYPE.float) numbers[index] = view.getFloat32(at, true);
    else if (chunk.type === TYPE.double) numbers[index] = view.getFloat64(at, true);
    else numbers[index] = view.getInt32(at + 4, true) * 2 ** 32 + view.getUint32(at, true);
  }
  return numbers;
}

/** Bytes as one character each: quadkeys are ASCII digits. */
function latin1(bytes: Uint8Array, start: number, end: number): string {
  let text = "";
  for (let index = start; index < end; index += 1) text += String.fromCharCode(bytes[index]!);
  return text;
}

/**
 * Parquet's RLE / bit-packed hybrid (Encodings.md): fills `output` with
 * values `width` bits wide from `bytes` between `start` and `end`.
 */
export function hybrid(bytes: Uint8Array, start: number, end: number, width: number, output: Uint8Array | Uint32Array): void {
  let position = start;
  let written = 0;
  const varint = (): number => {
    let value = 0;
    let scale = 1;
    for (let index = 0; index < 5; index += 1) {
      if (position >= end) throw invalid("an RLE run header is truncated");
      const byte = bytes[position]!;
      position += 1;
      value += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return value;
      scale *= 128;
    }
    throw invalid("an RLE run header is too long");
  };
  while (written < output.length) {
    const header = varint();
    if (header % 2 === 0) {
      const count = header / 2;
      const size = Math.ceil(width / 8);
      if (position + size > end) throw invalid("an RLE run is truncated");
      let value = 0;
      for (let index = 0; index < size; index += 1) value += bytes[position + index]! * 2 ** (8 * index);
      position += size;
      if (count === 0 || written + count > output.length) throw invalid("an RLE run overruns its values");
      output.fill(value, written, written + count);
      written += count;
      continue;
    }
    const groups = (header - 1) / 2;
    const size = groups * width;
    if (groups === 0 || position + size > end) throw invalid("a bit-packed run is truncated");
    const count = Math.min(groups * 8, output.length - written);
    let at = position;
    if (width <= 24) {
      // Up to 24 bits a value, the bits waiting never exceed 31: 32-bit integer arithmetic, read unsigned.
      const mask = (1 << width) - 1;
      let buffer = 0;
      let bits = 0;
      for (let index = 0; index < count; index += 1) {
        while (bits < width) {
          buffer |= bytes[at]! << bits;
          at += 1;
          bits += 8;
        }
        output[written + index] = buffer & mask;
        buffer >>>= width;
        bits -= width;
      }
    } else {
      const mask = 2 ** width;
      let buffer = 0;
      let bits = 0;
      for (let index = 0; index < count; index += 1) {
        while (bits < width) {
          buffer += bytes[at]! * 2 ** bits;
          at += 1;
          bits += 8;
        }
        output[written + index] = buffer % mask;
        buffer = Math.floor(buffer / mask);
        bits -= width;
      }
    }
    position += size;
    written += count;
  }
}

/**
 * The pages of one column chunk, read from its stream as they arrive. A page's
 * payload is either read whole or skipped without being held.
 */
class ChunkPages {
  private readonly queue: ByteQueue;
  private consumed = 0;

  constructor(
    stream: ReadableStream<Uint8Array>,
    private readonly length: number,
  ) {
    this.queue = new ByteQueue(stream);
  }

  /** The next page's header, or nothing once the chunk is read. */
  async next(): Promise<PageHeader | undefined> {
    if (this.consumed === this.length) return undefined;
    // Headers are some tens of bytes: read ahead little, so that stopping after one leaves the rest unfetched.
    for (let want = 64; ; want *= 2) {
      await this.queue.fill(want);
      const bytes = this.queue.peek(Math.min(want, this.queue.available, this.length - this.consumed));
      try {
        const { struct: header, end } = readStruct(bytes);
        this.queue.drop(end);
        this.consumed += end;
        const page = pageHeader(header);
        if (this.consumed + page.compressed > this.length) throw invalid("a page runs past its column chunk");
        return page;
      } catch (error) {
        if (error instanceof ThriftInvalid) throw invalid(`a page header is malformed: ${error.message}`);
        if (!(error instanceof ThriftUnderflow)) throw error;
        if (bytes.byteLength >= this.length - this.consumed || this.queue.ended) throw invalid("the column chunk ends inside a page header");
        if (want >= MAX_PAGE_HEADER_BYTES) throw invalid("a page header is longer than any this reader takes");
      }
    }
  }

  async payload(page: PageHeader): Promise<Uint8Array> {
    await this.queue.fill(page.compressed);
    if (this.queue.available < page.compressed) throw invalid("the column chunk ends inside a page");
    this.consumed += page.compressed;
    return this.queue.take(page.compressed);
  }

  async skip(page: PageHeader): Promise<void> {
    await this.queue.discard(page.compressed);
    this.consumed += page.compressed;
  }

  /** Stops reading: whatever of the chunk is still to come is never fetched. */
  async close(): Promise<void> {
    await this.queue.cancel();
  }
}

/** Bytes arriving from a stream, held only until they are taken or dropped. */
class ByteQueue {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  /** Held chunks from `head` on; those before it are spent, and cleared away now and then. */
  private chunks: Uint8Array[] = [];
  private head = 0;
  available = 0;
  ended = false;

  constructor(stream: ReadableStream<Uint8Array>) {
    this.reader = stream.getReader();
  }

  private async pull(): Promise<boolean> {
    if (this.ended) return false;
    const { done, value } = await this.reader.read();
    if (done) {
      this.ended = true;
      return false;
    }
    if (value.byteLength > 0) {
      this.chunks.push(value);
      this.available += value.byteLength;
    }
    return true;
  }

  /** Reads until `count` bytes are held or the stream ends. */
  async fill(count: number): Promise<void> {
    while (this.available < count && (await this.pull()));
  }

  /** The first `count` held bytes, contiguous. */
  peek(count: number): Uint8Array {
    const first = this.chunks[this.head];
    if (first && first.byteLength >= count) return first.subarray(0, count);
    const joined = this.take(count);
    if (this.head > 0) {
      this.head -= 1;
      this.chunks[this.head] = joined;
    } else this.chunks.unshift(joined);
    this.available += joined.byteLength;
    return joined;
  }

  take(count: number): Uint8Array {
    if (count > this.available) throw invalid("a read ran past the bytes held");
    const first = this.chunks[this.head];
    if (first && first.byteLength >= count) {
      this.drop(count);
      return first.subarray(0, count);
    }
    const output = new Uint8Array(count);
    let written = 0;
    while (written < count) {
      const chunk = this.chunks[this.head]!;
      const size = Math.min(chunk.byteLength, count - written);
      output.set(chunk.subarray(0, size), written);
      written += size;
      this.drop(size);
    }
    return output;
  }

  drop(count: number): void {
    let left = count;
    while (left > 0) {
      const chunk = this.chunks[this.head];
      if (!chunk) throw invalid("a read ran past the bytes held");
      if (chunk.byteLength <= left) {
        this.head += 1;
        left -= chunk.byteLength;
        this.available -= chunk.byteLength;
      } else {
        this.chunks[this.head] = chunk.subarray(left);
        this.available -= left;
        left = 0;
      }
    }
    if (this.head > 1024 && this.head * 2 > this.chunks.length) {
      this.chunks = this.chunks.slice(this.head);
      this.head = 0;
    }
  }

  /** Drops `count` bytes, reading through those not yet arrived without holding them. */
  async discard(count: number): Promise<void> {
    let left = count;
    while (left > 0) {
      if (this.available === 0 && !(await this.pull())) throw invalid("the column chunk ends inside a page");
      const size = Math.min(left, this.available);
      this.drop(size);
      left -= size;
    }
  }

  async cancel(): Promise<void> {
    this.chunks = [];
    this.head = 0;
    this.available = 0;
    if (!this.ended) await this.reader.cancel("Read no further").catch(() => undefined);
    this.ended = true;
  }
}
