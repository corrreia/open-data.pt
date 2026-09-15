import { GatekeeperError } from "./index";

/**
 * Pass a byte stream through unchanged, failing it once more than `maximumBytes`
 * have flowed. Streaming normalizers never hold the whole source, so the source
 * budget is enforced on the wire rather than on a buffer.
 */
export function limitBytes(body: ReadableStream<Uint8Array>, maximumBytes: number): ReadableStream<Uint8Array> {
  let seen = 0;
  return body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > maximumBytes) {
        controller.error(new GatekeeperError(`Source response exceeds ${maximumBytes} bytes`, "response-too-large"));
        return;
      }
      controller.enqueue(chunk);
    },
  }));
}

/** Buffer a whole body, failing as soon as it exceeds `maximumBytes`. Only for formats that cannot stream. */
export async function readBoundedBytes(body: ReadableStream<Uint8Array> | Uint8Array, maximumBytes: number): Promise<Uint8Array> {
  if (body instanceof Uint8Array) {
    if (body.byteLength > maximumBytes) throw new GatekeeperError(`Source response exceeds ${maximumBytes} bytes`, "response-too-large");
    return body;
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  const reader = body.getReader();
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maximumBytes) {
      await reader.cancel("Source response exceeded its limit").catch(() => undefined);
      throw new GatekeeperError(`Source response exceeds ${maximumBytes} bytes`, "response-too-large");
    }
    chunks.push(part.value);
  }
  const output = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

/** A body as a byte stream, whether the adapter produced bytes or a stream. */
export function toByteStream(body: ReadableStream<Uint8Array> | Uint8Array): ReadableStream<Uint8Array> {
  if (!(body instanceof Uint8Array)) return body;
  return new ReadableStream<Uint8Array>({
    start(controller) {
      if (body.byteLength > 0) controller.enqueue(body);
      controller.close();
    },
  });
}
