import { GatekeeperError } from "../../index";

/** Largest compressed archive read from the wire, whatever the feed policy allows. */
export const MAX_ARCHIVE_BYTES = 128 * 1024 * 1024;
/**
 * Largest inflated size of one normalized entry. Rows stream, so this does not
 * bound memory; it bounds work, so a DEFLATE bomb fails instead of spinning.
 */
export const MAX_ENTRY_BYTES = 256 * 1024 * 1024;

const LOCAL_FILE = 0x04034b50;
const CENTRAL_FILE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const DATA_DESCRIPTOR = 0x08074b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const FLAG_ENCRYPTED = 0x1;
const FLAG_DATA_DESCRIPTOR = 0x8;
const STORED = 0;
const DEFLATED = 8;
const CHUNK_SIZE = 64 * 1024;

/** One wanted archive entry, inflated while the caller reads it. */
export interface GtfsZipEntry {
  /** Lower-case base name such as `stops.txt`, whatever folder the archive used. */
  name: string;
  /** Inflated bytes as they decompress. Read to the end before asking for the next entry. */
  chunks: AsyncIterable<Uint8Array>;
}

export interface GtfsZipOptions {
  maximumArchiveBytes?: number;
  maximumEntryBytes?: number;
}

interface LocalEntry {
  name: string;
  method: number;
  /** Sizes from the local header or its ZIP64 field; usually 0 when a data descriptor follows the data. */
  compressedSize: number;
  uncompressedSize: number;
  descriptor: boolean;
  zip64: boolean;
}

/**
 * Walk a ZIP archive by its local file headers, in file order, holding at most
 * one network chunk of it. Wanted entries are inflated while the caller reads
 * them; every other entry is skipped by its compressed length or, for DEFLATE
 * entries sized only by a trailing data descriptor, by parsing DEFLATE blocks up
 * to the final one. Reading stops at the central directory or as soon as every
 * wanted entry was read, and the body is cancelled either way.
 */
export async function* gtfsZipEntries(body: ReadableStream<Uint8Array>, wanted: ReadonlySet<string>, options: GtfsZipOptions = {}): AsyncGenerator<GtfsZipEntry> {
  const input = new ZipInput(body, options.maximumArchiveBytes ?? MAX_ARCHIVE_BYTES);
  const maximumEntryBytes = options.maximumEntryBytes ?? MAX_ENTRY_BYTES;
  const remaining = new Set(wanted);
  try {
    while (remaining.size > 0) {
      const signature = uint32(await input.readExact(4), 0);
      if (signature === CENTRAL_FILE || signature === END_OF_CENTRAL_DIRECTORY) break;
      if (signature !== LOCAL_FILE) {
        throw invalidZip(`Unexpected ZIP record signature 0x${signature.toString(16)}`);
      }
      const entry = await readLocalHeader(input);
      if (!remaining.has(entry.name)) {
        await skipEntry(input, entry);
        continue;
      }
      remaining.delete(entry.name);
      const reader = new EntryReader(input, entry, maximumEntryBytes);
      yield { name: entry.name, chunks: reader.chunks() };
      if (!reader.finished) {
        throw new Error(`GTFS entry ${entry.name} was not read to its end before the next entry`);
      }
    }
  } catch (error) {
    throw error instanceof GatekeeperError ? error : invalidZip(error instanceof Error ? error.message : String(error));
  } finally {
    await input.cancel("GTFS ZIP reading finished").catch(() => undefined);
  }
}

async function readLocalHeader(input: ZipInput): Promise<LocalEntry> {
  const header = await input.readExact(26);
  const flags = uint16(header, 2);
  const method = uint16(header, 4);
  let compressedSize = uint32(header, 14);
  let uncompressedSize = uint32(header, 18);
  const name = canonicalEntryName(new TextDecoder().decode(await input.readExact(uint16(header, 22))));
  const zip64 = extraField(await input.readExact(uint16(header, 24)), ZIP64_EXTRA_FIELD);
  if ((flags & FLAG_ENCRYPTED) !== 0) throw invalidZip(`GTFS entry ${name} is encrypted`);
  if (compressedSize === 0xffffffff || uncompressedSize === 0xffffffff) {
    // A local ZIP64 field carries both sizes: uncompressed first, then compressed.
    if (!zip64 || zip64.byteLength < 16) throw invalidZip(`GTFS entry ${name} has no ZIP64 sizes`);
    uncompressedSize = uint64(zip64, 0);
    compressedSize = uint64(zip64, 8);
  }
  return {
    name,
    method,
    compressedSize,
    uncompressedSize,
    descriptor: (flags & FLAG_DATA_DESCRIPTOR) !== 0,
    zip64: zip64 !== undefined,
  };
}

async function skipEntry(input: ZipInput, entry: LocalEntry): Promise<void> {
  if (!entry.descriptor) {
    await input.discard(entry.compressedSize);
    return;
  }
  if (entry.method === DEFLATED) {
    const boundary = new DeflateBoundary();
    const walk = deflateUntilFinalBlock(input, boundary);
    while (!(await walk.next()).done) {
      // Skipped bytes are only measured, never inflated.
    }
    await readDataDescriptor(input, entry, boundary.compressedBytes, boundary.uncompressedBytes);
    return;
  }
  if (entry.method !== STORED || entry.compressedSize === 0) throw undelimitedEntry(entry);
  await input.discard(entry.compressedSize);
  await readDataDescriptor(input, entry, entry.compressedSize, entry.compressedSize);
}

/** Reads one wanted entry; `finished` turns true only once its data and descriptor were consumed. */
class EntryReader {
  finished = false;

  private readonly input: ZipInput;
  private readonly entry: LocalEntry;
  private readonly maximumBytes: number;

  constructor(input: ZipInput, entry: LocalEntry, maximumBytes: number) {
    this.input = input;
    this.entry = entry;
    this.maximumBytes = maximumBytes;
  }

  async *chunks(): AsyncGenerator<Uint8Array> {
    const { entry, input, maximumBytes } = this;
    try {
      const boundary = entryBoundary(entry, maximumBytes);
      const compressed = boundary ? deflateUntilFinalBlock(input, boundary) : sizedChunks(input, entry.compressedSize);
      let inflated = 0;
      for await (const chunk of entry.method === STORED ? compressed : inflate(compressed)) {
        inflated += chunk.byteLength;
        if (inflated > maximumBytes) throw entryTooLarge(entry.name, maximumBytes);
        yield chunk;
      }
      if (boundary) {
        if (inflated !== boundary.uncompressedBytes) {
          throw invalidZip(`GTFS entry ${entry.name} inflated to a different size than its DEFLATE stream declares`);
        }
        await readDataDescriptor(input, entry, boundary.compressedBytes, inflated);
      } else if (entry.descriptor) {
        await readDataDescriptor(input, entry, entry.compressedSize, inflated);
      } else if (inflated !== entry.uncompressedSize) {
        throw invalidZip(`GTFS entry ${entry.name} size did not match its local header`);
      }
      this.finished = true;
    } catch (error) {
      throw error instanceof GatekeeperError ? error : invalidZip(`GTFS entry ${entry.name} could not be inflated: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

/** How a wanted entry's end is found: its local size, or the DEFLATE parser when only a descriptor has it. */
function entryBoundary(entry: LocalEntry, maximumBytes: number): DeflateBoundary | undefined {
  if (entry.method !== STORED && entry.method !== DEFLATED) {
    throw invalidZip(`GTFS entry ${entry.name} uses unsupported ZIP compression method ${entry.method}`);
  }
  if (!entry.descriptor) {
    if (entry.uncompressedSize > maximumBytes) throw entryTooLarge(entry.name, maximumBytes);
    return undefined;
  }
  if (entry.method === DEFLATED) return new DeflateBoundary();
  if (entry.compressedSize === 0) throw undelimitedEntry(entry);
  return undefined;
}

async function* sizedChunks(input: ZipInput, size: number): AsyncGenerator<Uint8Array> {
  let remaining = size;
  while (remaining > 0) {
    const chunk = await input.readSome(Math.min(CHUNK_SIZE, remaining));
    if (chunk.byteLength === 0) throw invalidZip("Unexpected end of ZIP entry");
    remaining -= chunk.byteLength;
    yield chunk;
  }
}

/** Compressed bytes of a descriptor-sized DEFLATE entry, up to the end of its final block and no further. */
async function* deflateUntilFinalBlock(input: ZipInput, boundary: DeflateBoundary): AsyncGenerator<Uint8Array> {
  while (!boundary.done) {
    const chunk = await input.readSome(CHUNK_SIZE);
    if (chunk.byteLength === 0) throw invalidZip("Unexpected end of deflated ZIP entry");
    const used = boundary.consume(chunk);
    if (used === 0 && !boundary.done) throw invalidZip("Deflate parser made no progress");
    if (used < chunk.byteLength) input.unshift(chunk.subarray(used));
    if (used > 0) yield chunk.subarray(0, used);
  }
}

/**
 * Inflate a compressed chunk sequence. A pump writes compressed bytes while the
 * caller reads inflated ones, so the caller's read rate is the only thing that
 * pulls more of the archive off the wire.
 */
async function* inflate(compressed: AsyncIterable<Uint8Array>): AsyncGenerator<Uint8Array> {
  const stream = new DecompressionStream("deflate-raw");
  const writer = stream.writable.getWriter();
  const reader = stream.readable.getReader();
  const pump = (async () => {
    try {
      for await (const chunk of compressed) await writer.write(chunk);
      await writer.close();
    } catch (error) {
      await writer.abort(error).catch(() => undefined);
      throw error;
    }
  })();
  // Awaited below; this only keeps an early failure from surfacing as unhandled.
  pump.catch(() => undefined);
  let completed = false;
  try {
    while (true) {
      let part: ReadableStreamReadResult<Uint8Array>;
      try {
        part = await reader.read();
      } catch (error) {
        // Prefer the pump's own failure (a truncated archive) over the stream's echo of it.
        await pump;
        throw error;
      }
      if (part.done) break;
      yield part.value;
    }
    await pump;
    completed = true;
  } finally {
    if (!completed) {
      await reader.cancel("GTFS entry was abandoned").catch(() => undefined);
      await pump.catch(() => undefined);
    }
  }
}

async function readDataDescriptor(input: ZipInput, entry: LocalEntry, compressedBytes: number, uncompressedBytes: number): Promise<void> {
  // The descriptor signature is optional; without it the first word is the CRC-32.
  if (uint32(await input.readExact(4), 0) === DATA_DESCRIPTOR) await input.discard(4);
  const sizes = await input.readExact(entry.zip64 ? 16 : 8);
  const declaredCompressed = entry.zip64 ? uint64(sizes, 0) : uint32(sizes, 0);
  const declaredUncompressed = entry.zip64 ? uint64(sizes, 8) : uint32(sizes, 4);
  if (declaredCompressed !== compressedBytes || declaredUncompressed !== uncompressedBytes) {
    throw invalidZip(`GTFS entry ${entry.name} data descriptor sizes did not match the entry`);
  }
}

class ZipInput {
  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private pending: Uint8Array[] = [];
  private received = 0;

  private readonly maximumBytes: number;

  constructor(body: ReadableStream<Uint8Array>, maximumBytes: number) {
    this.maximumBytes = maximumBytes;
    this.reader = body.getReader();
  }

  async readExact(size: number): Promise<Uint8Array> {
    const result = new Uint8Array(size);
    let offset = 0;
    while (offset < size) {
      const chunk = await this.readSome(size - offset);
      if (chunk.byteLength === 0) throw invalidZip("Unexpected end of ZIP archive");
      result.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return result;
  }

  async readSome(maximum: number): Promise<Uint8Array> {
    while (this.pending.length === 0) {
      const part = await this.reader.read();
      if (part.done) return new Uint8Array();
      this.received += part.value.byteLength;
      if (this.received > this.maximumBytes) {
        await this.reader.cancel("GTFS ZIP exceeded maximum archive size");
        throw new GatekeeperError(`GTFS ZIP exceeded ${this.maximumBytes} bytes`, "response-too-large");
      }
      if (part.value.byteLength > 0) this.pending.push(part.value);
    }
    const first = this.pending[0];
    if (!first) return new Uint8Array();
    if (first.byteLength <= maximum) {
      this.pending.shift();
      return first;
    }
    this.pending[0] = first.subarray(maximum);
    return first.subarray(0, maximum);
  }

  unshift(bytes: Uint8Array): void {
    if (bytes.byteLength > 0) this.pending.unshift(bytes);
  }

  async discard(size: number): Promise<void> {
    let remaining = size;
    while (remaining > 0) {
      const chunk = await this.readSome(Math.min(CHUNK_SIZE, remaining));
      if (chunk.byteLength === 0) throw invalidZip("Unexpected end of ZIP entry");
      remaining -= chunk.byteLength;
    }
  }

  async cancel(reason: string): Promise<void> {
    this.pending = [];
    await this.reader.cancel(reason);
  }
}

/** Incremental RFC 1951 parser used only to locate the end of a descriptor-sized stream. */
class DeflateBoundary {
  done = false;
  compressedBytes = 0;
  uncompressedBytes = 0;
  private finalBlock = false;
  private phase: Phase = "block-header";
  private bits = 0;
  private bitCount = 0;
  private input?: Uint8Array;
  private inputOffset = 0;
  private literalTree?: HuffmanTree;
  private distanceTree?: HuffmanTree;
  private decodeCode = 0;
  private decodeLength = 0;
  private storedRemaining = 0;
  private dynamicLiteralCount = 0;
  private dynamicDistanceCount = 0;
  private dynamicCodeCount = 0;
  private dynamicCodeIndex = 0;
  private dynamicCodeLengths = Array.from<number>({ length: 19 }).fill(0);
  private dynamicLengths: number[] = [];
  private codeLengthTree?: HuffmanTree;
  private repeatSymbol = 0;
  private pendingLength = 0;
  private pendingDistanceSymbol = 0;

  consume(chunk: Uint8Array): number {
    this.input = chunk;
    this.inputOffset = 0;
    while (!this.done && this.step()) {
      // Continue while the current chunk can advance the parser.
    }
    this.compressedBytes += this.inputOffset;
    return this.inputOffset;
  }

  private step(): boolean {
    switch (this.phase) {
      case "block-header": {
        const value = this.take(3);
        if (value === undefined) return false;
        this.finalBlock = (value & 1) === 1;
        const type = value >> 1;
        if (type === 0) {
          const padding = this.bitCount % 8;
          this.bits = Math.floor(this.bits / 2 ** padding);
          this.bitCount -= padding;
          this.phase = "stored-header";
        } else if (type === 1) {
          this.literalTree = FIXED_LITERAL_TREE;
          this.distanceTree = FIXED_DISTANCE_TREE;
          this.phase = "compressed-symbol";
        } else if (type === 2) {
          this.phase = "dynamic-header";
        } else {
          throw invalidZip("Reserved DEFLATE block type");
        }
        return true;
      }
      case "stored-header": {
        const value = this.take(32);
        if (value === undefined) return false;
        const length = value & 0xffff;
        const inverse = (value >>> 16) & 0xffff;
        if (((length ^ 0xffff) & 0xffff) !== inverse) throw invalidZip("Invalid stored DEFLATE block length");
        this.storedRemaining = length;
        this.phase = "stored-data";
        return true;
      }
      case "stored-data": {
        if (this.storedRemaining === 0) return this.finishBlock();
        const availableBytes = Math.floor(this.bitCount / 8) + ((this.input?.byteLength ?? 0) - this.inputOffset);
        if (availableBytes === 0) return false;
        const count = Math.min(this.storedRemaining, availableBytes);
        for (let index = 0; index < count; index += 1) {
          if (this.take(8) === undefined) return false;
        }
        this.storedRemaining -= count;
        this.uncompressedBytes += count;
        return true;
      }
      case "dynamic-header": {
        const value = this.take(14);
        if (value === undefined) return false;
        this.dynamicLiteralCount = (value & 0x1f) + 257;
        this.dynamicDistanceCount = ((value >>> 5) & 0x1f) + 1;
        this.dynamicCodeCount = ((value >>> 10) & 0x0f) + 4;
        this.dynamicCodeIndex = 0;
        this.dynamicCodeLengths.fill(0);
        this.dynamicLengths = [];
        this.phase = "dynamic-code-lengths";
        return true;
      }
      case "dynamic-code-lengths": {
        while (this.dynamicCodeIndex < this.dynamicCodeCount) {
          const value = this.take(3);
          if (value === undefined) return false;
          const target = CODE_LENGTH_ORDER[this.dynamicCodeIndex];
          if (target === undefined) throw invalidZip("Invalid DEFLATE code-length index");
          this.dynamicCodeLengths[target] = value;
          this.dynamicCodeIndex += 1;
        }
        this.codeLengthTree = buildTree(this.dynamicCodeLengths);
        this.phase = "dynamic-length-symbol";
        return true;
      }
      case "dynamic-length-symbol": {
        if (this.dynamicLengths.length >= this.dynamicLiteralCount + this.dynamicDistanceCount) {
          this.literalTree = buildTree(this.dynamicLengths.slice(0, this.dynamicLiteralCount));
          this.distanceTree = buildTree(this.dynamicLengths.slice(this.dynamicLiteralCount));
          this.phase = "compressed-symbol";
          return true;
        }
        const symbol = this.decode(this.codeLengthTree);
        if (symbol === undefined) return false;
        if (symbol <= 15) {
          this.dynamicLengths.push(symbol);
        } else if (symbol <= 18) {
          this.repeatSymbol = symbol;
          this.phase = "dynamic-repeat";
        } else {
          throw invalidZip("Invalid DEFLATE code-length symbol");
        }
        return true;
      }
      case "dynamic-repeat": {
        const extraBits = this.repeatSymbol === 16 ? 2 : this.repeatSymbol === 17 ? 3 : 7;
        const extra = this.take(extraBits);
        if (extra === undefined) return false;
        const count = extra + (this.repeatSymbol === 16 ? 3 : this.repeatSymbol === 17 ? 3 : 11);
        const value = this.repeatSymbol === 16 ? this.dynamicLengths.at(-1) : 0;
        if (value === undefined) throw invalidZip("DEFLATE repeat had no previous code length");
        if (this.dynamicLengths.length + count > this.dynamicLiteralCount + this.dynamicDistanceCount) {
          throw invalidZip("DEFLATE code-length repeat exceeded its table");
        }
        for (let index = 0; index < count; index += 1) this.dynamicLengths.push(value);
        this.phase = "dynamic-length-symbol";
        return true;
      }
      case "compressed-symbol": {
        const symbol = this.decode(this.literalTree);
        if (symbol === undefined) return false;
        if (symbol < 256) {
          this.uncompressedBytes += 1;
          return true;
        }
        if (symbol === 256) return this.finishBlock();
        if (symbol > 285) throw invalidZip("Invalid DEFLATE length symbol");
        const index = symbol - 257;
        const base = LENGTH_BASE[index];
        const extra = LENGTH_EXTRA[index];
        if (base === undefined || extra === undefined) throw invalidZip("Invalid DEFLATE length table index");
        this.pendingLength = base;
        this.phase = extra === 0 ? "distance-symbol" : "length-extra";
        if (extra === 0) this.uncompressedBytes += this.pendingLength;
        return true;
      }
      case "length-extra": {
        const symbol = this.pendingLength;
        const index = LENGTH_BASE.indexOf(symbol);
        const extraBits = LENGTH_EXTRA[index];
        if (extraBits === undefined) throw invalidZip("Invalid DEFLATE length state");
        const extra = this.take(extraBits);
        if (extra === undefined) return false;
        this.pendingLength += extra;
        this.uncompressedBytes += this.pendingLength;
        this.phase = "distance-symbol";
        return true;
      }
      case "distance-symbol": {
        const symbol = this.decode(this.distanceTree);
        if (symbol === undefined) return false;
        if (symbol > 29) throw invalidZip("Invalid DEFLATE distance symbol");
        this.pendingDistanceSymbol = symbol;
        this.phase = DISTANCE_EXTRA[symbol] === 0 ? "compressed-symbol" : "distance-extra";
        return true;
      }
      case "distance-extra": {
        const extraBits = DISTANCE_EXTRA[this.pendingDistanceSymbol];
        if (extraBits === undefined) throw invalidZip("Invalid DEFLATE distance state");
        if (this.take(extraBits) === undefined) return false;
        this.phase = "compressed-symbol";
        return true;
      }
    }
  }

  private finishBlock(): boolean {
    if (this.finalBlock) {
      this.done = true;
    } else {
      this.phase = "block-header";
    }
    return true;
  }

  private decode(tree: HuffmanTree | undefined): number | undefined {
    if (!tree) throw invalidZip("Missing DEFLATE Huffman tree");
    while (this.decodeLength < tree.maximumLength) {
      const bit = this.take(1);
      if (bit === undefined) return undefined;
      this.decodeCode |= bit << this.decodeLength;
      this.decodeLength += 1;
      const symbol = tree.symbols.get((this.decodeLength << 16) | this.decodeCode);
      if (symbol !== undefined) {
        this.decodeCode = 0;
        this.decodeLength = 0;
        return symbol;
      }
    }
    throw invalidZip("Invalid DEFLATE Huffman code");
  }

  private take(count: number): number | undefined {
    while (this.bitCount < count) {
      const byte = this.input?.[this.inputOffset];
      if (byte === undefined) return undefined;
      this.bits += byte * 2 ** this.bitCount;
      this.bitCount += 8;
      this.inputOffset += 1;
    }
    const divisor = 2 ** count;
    const value = this.bits % divisor;
    this.bits = Math.floor(this.bits / divisor);
    this.bitCount -= count;
    return value;
  }
}

type Phase =
  | "block-header"
  | "stored-header"
  | "stored-data"
  | "dynamic-header"
  | "dynamic-code-lengths"
  | "dynamic-length-symbol"
  | "dynamic-repeat"
  | "compressed-symbol"
  | "length-extra"
  | "distance-symbol"
  | "distance-extra";

interface HuffmanTree {
  maximumLength: number;
  symbols: Map<number, number>;
}

function buildTree(lengths: readonly number[]): HuffmanTree {
  const maximumLength = Math.max(...lengths);
  if (maximumLength === 0) return { maximumLength: 0, symbols: new Map() };
  const counts = Array.from<number>({ length: maximumLength + 1 }).fill(0);
  for (const length of lengths) {
    if (length > 0) counts[length] = (counts[length] ?? 0) + 1;
  }
  const next = Array.from<number>({ length: maximumLength + 1 }).fill(0);
  let code = 0;
  for (let bits = 1; bits <= maximumLength; bits += 1) {
    code = (code + (counts[bits - 1] ?? 0)) << 1;
    next[bits] = code;
  }
  const symbols = new Map<number, number>();
  lengths.forEach((length, symbol) => {
    if (length === 0) return;
    const canonical = next[length] ?? 0;
    next[length] = canonical + 1;
    symbols.set((length << 16) | reverseBits(canonical, length), symbol);
  });
  return { maximumLength, symbols };
}

function reverseBits(value: number, length: number): number {
  let reversed = 0;
  for (let index = 0; index < length; index += 1) {
    reversed = (reversed << 1) | ((value >>> index) & 1);
  }
  return reversed;
}

function fixedLiteralLengths(): number[] {
  return Array.from({ length: 288 }, (_, symbol) => (symbol <= 143 ? 8 : symbol <= 255 ? 9 : symbol <= 279 ? 7 : 8));
}

const FIXED_LITERAL_TREE = buildTree(fixedLiteralLengths());
const FIXED_DISTANCE_TREE = buildTree(Array.from<number>({ length: 32 }).fill(5));
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];
const LENGTH_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LENGTH_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DISTANCE_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];

function canonicalEntryName(name: string): string {
  return name.replaceAll("\\", "/").split("/").at(-1)?.toLowerCase() ?? "";
}

/** The data of one extra field in a local header's extra block, when present. */
function extraField(extra: Uint8Array, id: number): Uint8Array | undefined {
  let offset = 0;
  while (offset + 4 <= extra.byteLength) {
    const size = uint16(extra, offset + 2);
    if (uint16(extra, offset) === id) return extra.subarray(offset + 4, offset + 4 + size);
    offset += 4 + size;
  }
  return undefined;
}

function uint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function uint32(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) + (bytes[offset + 1] ?? 0) * 2 ** 8 + (bytes[offset + 2] ?? 0) * 2 ** 16 + (bytes[offset + 3] ?? 0) * 2 ** 24;
}

function uint64(bytes: Uint8Array, offset: number): number {
  const value = uint32(bytes, offset) + uint32(bytes, offset + 4) * 2 ** 32;
  if (!Number.isSafeInteger(value)) throw invalidZip("ZIP64 size exceeds 2^53 bytes");
  return value;
}

function invalidZip(message: string): GatekeeperError {
  return new GatekeeperError(message, "invalid-response");
}

function entryTooLarge(name: string, maximumBytes: number): GatekeeperError {
  return new GatekeeperError(`GTFS entry ${name} inflates past ${maximumBytes} bytes`, "response-too-large");
}

function undelimitedEntry(entry: LocalEntry): GatekeeperError {
  return invalidZip(`GTFS entry ${entry.name} (ZIP method ${entry.method}) has its size only in a trailing data descriptor, so its end cannot be found while streaming`);
}
