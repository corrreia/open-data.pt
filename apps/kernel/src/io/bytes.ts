/**
 * Read one external byte stream under a strict ceiling. A declared length over
 * the ceiling is refused before reading; a streaming overflow cancels the
 * producer. The returned buffer is never larger than `maximumBytes`.
 */
export async function readBoundedBytes(
  stream: ReadableStream<Uint8Array>,
  contentLength: string | null | undefined,
  maximumBytes: number,
  error: () => Error,
): Promise<Uint8Array> {
  const declared = declaredLength(contentLength);
  if (declared !== undefined && declared > maximumBytes) {
    await stream.cancel("External body declared more bytes than allowed").catch(() => undefined);
    throw error();
  }

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > maximumBytes) {
        await reader.cancel("External body exceeded its byte ceiling").catch(() => undefined);
        throw error();
      }
      chunks.push(part.value);
    }
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 1) return chunks[0]!;
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function declaredLength(value: string | null | undefined): number | undefined {
  const text = value?.trim();
  if (!text || !/^\d+$/.test(text)) return undefined;
  const length = Number(text);
  return Number.isSafeInteger(length) ? length : undefined;
}
