/**
 * Snappy's raw block format (github.com/google/snappy, format_description.txt),
 * which Parquet compresses each page with: a varint of the uncompressed length,
 * then literals and back-references. Every read and copy is bounds-checked, so a
 * malformed page fails instead of reading or writing past its buffers.
 */
export class SnappyInvalid extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SnappyInvalid";
  }
}

/** Decompresses one block whose uncompressed length the page header already states. */
export function snappyUncompress(input: Uint8Array, expectedLength: number): Uint8Array {
  let position = 0;
  let length = 0;
  let scale = 1;
  for (let index = 0; ; index += 1) {
    if (index === 5 || position >= input.byteLength) throw new SnappyInvalid("Snappy block has no valid length");
    const byte = input[position]!;
    position += 1;
    length += (byte & 0x7f) * scale;
    if ((byte & 0x80) === 0) break;
    scale *= 128;
  }
  if (length !== expectedLength) throw new SnappyInvalid(`Snappy block holds ${length} bytes, not the ${expectedLength} its page states`);
  const output = new Uint8Array(length);
  let written = 0;
  while (position < input.byteLength) {
    const tag = input[position]!;
    position += 1;
    const kind = tag & 3;
    if (kind === 0) {
      let size = tag >> 2;
      if (size >= 60) {
        const extra = size - 59;
        if (position + extra > input.byteLength) throw new SnappyInvalid("Snappy literal length is truncated");
        size = 0;
        for (let index = 0; index < extra; index += 1) size += input[position + index]! * 2 ** (8 * index);
        position += extra;
      }
      size += 1;
      if (position + size > input.byteLength || written + size > length) throw new SnappyInvalid("Snappy literal overruns its block");
      output.set(input.subarray(position, position + size), written);
      position += size;
      written += size;
      continue;
    }
    let size: number;
    let distance: number;
    if (kind === 1) {
      if (position + 1 > input.byteLength) throw new SnappyInvalid("Snappy copy is truncated");
      size = ((tag >> 2) & 7) + 4;
      distance = ((tag >> 5) << 8) | input[position]!;
      position += 1;
    } else if (kind === 2) {
      if (position + 2 > input.byteLength) throw new SnappyInvalid("Snappy copy is truncated");
      size = (tag >> 2) + 1;
      distance = input[position]! | (input[position + 1]! << 8);
      position += 2;
    } else {
      if (position + 4 > input.byteLength) throw new SnappyInvalid("Snappy copy is truncated");
      size = (tag >> 2) + 1;
      distance = (input[position]! | (input[position + 1]! << 8) | (input[position + 2]! << 16)) + input[position + 3]! * 2 ** 24;
      position += 4;
    }
    if (distance === 0 || distance > written || written + size > length) throw new SnappyInvalid("Snappy copy reaches outside its block");
    // A copy may overlap what it writes (a run), so it goes a byte at a time when it does, or when it is short.
    if (distance >= size && size > 16) output.copyWithin(written, written - distance, written - distance + size);
    else for (let index = 0; index < size; index += 1) output[written + index] = output[written - distance + index]!;
    written += size;
  }
  if (written !== length) throw new SnappyInvalid(`Snappy block decompressed to ${written} bytes, not ${length}`);
  return output;
}
