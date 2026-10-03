/**
 * Apache Thrift's compact protocol, as far as Parquet's metadata uses it: the
 * file footer and every page header are one struct each. Reads a struct into
 * its fields by number, bounded by the bytes it is handed, and says when they
 * ran out before the struct ended, so a page header can be read from a stream
 * as its bytes arrive.
 */

/** One value a struct field holds. Integers of every width are numbers: Parquet's offsets, sizes and counts are far below 2^53. */
export type ThriftValue = boolean | number | Uint8Array | ThriftStruct | readonly ThriftValue[];

/** The bytes ended before the struct did: more of them may complete it. */
export class ThriftUnderflow extends Error {
  constructor() {
    super("Thrift struct is truncated");
    this.name = "ThriftUnderflow";
  }
}

/** The bytes do not encode a struct this reader accepts. */
export class ThriftInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThriftInvalid";
  }
}

/** Nesting deeper than any Parquet struct goes is a malformed file, not a deeper struct. */
const MAX_DEPTH = 16;

/** A decoded struct: its fields by number, with typed accessors that refuse a field of another type. */
export class ThriftStruct {
  constructor(private readonly fields: ReadonlyMap<number, ThriftValue>) {}

  has(id: number): boolean {
    return this.fields.has(id);
  }

  integer(id: number): number | undefined {
    const value = this.fields.get(id);
    if (value === undefined) return undefined;
    if (!isNumber(value)) throw new ThriftInvalid(`Thrift field ${id} is not an integer`);
    return value;
  }

  requiredInteger(id: number): number {
    const value = this.integer(id);
    if (value === undefined) throw new ThriftInvalid(`Thrift field ${id} is missing`);
    return value;
  }

  binary(id: number): Uint8Array | undefined {
    const value = this.fields.get(id);
    if (value === undefined) return undefined;
    if (!(value instanceof Uint8Array)) throw new ThriftInvalid(`Thrift field ${id} is not binary`);
    return value;
  }

  string(id: number): string | undefined {
    const value = this.binary(id);
    return value === undefined ? undefined : new TextDecoder().decode(value);
  }

  struct(id: number): ThriftStruct | undefined {
    const value = this.fields.get(id);
    if (value === undefined) return undefined;
    if (!(value instanceof ThriftStruct)) throw new ThriftInvalid(`Thrift field ${id} is not a struct`);
    return value;
  }

  list(id: number): readonly ThriftValue[] {
    const value = this.fields.get(id);
    if (value === undefined) return [];
    if (!Array.isArray(value)) throw new ThriftInvalid(`Thrift field ${id} is not a list`);
    return value;
  }

  structs(id: number): ThriftStruct[] {
    return this.list(id).map((value) => {
      if (!(value instanceof ThriftStruct)) throw new ThriftInvalid(`Thrift field ${id} is not a list of structs`);
      return value;
    });
  }
}

function isNumber(value: ThriftValue): value is number {
  return Number.isFinite(value);
}

/** One struct read from bytes, and the offset just after it. */
export interface StructRead {
  struct: ThriftStruct;
  end: number;
}

/** One struct read from `bytes` at `offset`, and the offset just after it. */
export function readStruct(bytes: Uint8Array, offset = 0): StructRead {
  const reader = new Reader(bytes, offset);
  const struct = reader.struct(0);
  return { struct, end: reader.offset };
}

/** Compact-protocol element types (thrift/lib/cpp/src/thrift/protocol/TCompactProtocol.h). */
const TYPE = { true: 1, false: 2, byte: 3, i16: 4, i32: 5, i64: 6, double: 7, binary: 8, list: 9, set: 10, map: 11, struct: 12 } as const;

class Reader {
  offset: number;

  constructor(
    private readonly bytes: Uint8Array,
    offset: number,
  ) {
    this.offset = offset;
  }

  private byte(): number {
    if (this.offset >= this.bytes.byteLength) throw new ThriftUnderflow();
    const value = this.bytes[this.offset]!;
    this.offset += 1;
    return value;
  }

  /** An unsigned LEB128 varint of up to ten bytes, as a number: exact below 2^53. */
  private varint(): number {
    let value = 0;
    let scale = 1;
    for (let index = 0; index < 10; index += 1) {
      const byte = this.byte();
      value += (byte & 0x7f) * scale;
      if ((byte & 0x80) === 0) return value;
      scale *= 128;
    }
    throw new ThriftInvalid("Thrift varint is longer than ten bytes");
  }

  private zigzag(): number {
    const value = this.varint();
    return value % 2 === 0 ? value / 2 : -(value + 1) / 2;
  }

  struct(depth: number): ThriftStruct {
    if (depth > MAX_DEPTH) throw new ThriftInvalid("Thrift structs nest too deeply");
    const fields = new Map<number, ThriftValue>();
    let id = 0;
    for (;;) {
      const header = this.byte();
      if (header === 0) return new ThriftStruct(fields);
      const type = header & 0x0f;
      const delta = header >> 4;
      id = delta === 0 ? this.zigzag() : id + delta;
      fields.set(id, this.value(type, depth));
    }
  }

  private value(type: number, depth: number): ThriftValue {
    switch (type) {
      case TYPE.true:
        return true;
      case TYPE.false:
        return false;
      case TYPE.byte: {
        const byte = this.byte();
        return byte > 127 ? byte - 256 : byte;
      }
      case TYPE.i16:
      case TYPE.i32:
      case TYPE.i64:
        return this.zigzag();
      case TYPE.double: {
        if (this.offset + 8 > this.bytes.byteLength) throw new ThriftUnderflow();
        const value = new DataView(this.bytes.buffer, this.bytes.byteOffset + this.offset, 8).getFloat64(0, true);
        this.offset += 8;
        return value;
      }
      case TYPE.binary: {
        const length = this.varint();
        if (this.offset + length > this.bytes.byteLength) throw new ThriftUnderflow();
        const value = this.bytes.subarray(this.offset, this.offset + length);
        this.offset += length;
        return value;
      }
      case TYPE.list:
      case TYPE.set:
        return this.list(depth);
      case TYPE.struct:
        return this.struct(depth + 1);
      default:
        // Parquet's metadata holds no maps; anything else is not compact protocol.
        throw new ThriftInvalid(`Unsupported Thrift type ${type}`);
    }
  }

  private list(depth: number): ThriftValue[] {
    const header = this.byte();
    const type = header & 0x0f;
    const size = header >> 4 === 15 ? this.varint() : header >> 4;
    // Every element takes at least a byte, so a size beyond what is left is a lie, not a long list.
    if (size > this.bytes.byteLength - this.offset) throw new ThriftUnderflow();
    const values: ThriftValue[] = [];
    for (let index = 0; index < size; index += 1) {
      // A list's booleans are one byte each, 1 for true.
      values.push(type === TYPE.true || type === TYPE.false ? this.byte() === TYPE.true : this.value(type, depth + 1));
    }
    return values;
  }
}
