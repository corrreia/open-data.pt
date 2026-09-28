import {
  MAX_PRODUCTS,
  NormalizedInputError,
  assertHistoryProgress,
  frameBytesFor,
  isJsonObject,
  isNormalizedFrame,
  parseJson,
  type CollectionLimits,
  type CollectionRequest,
  type NormalizedFrame,
  type ProductDeclaration,
} from "@open-data-pt/contract";

import { CollectionDeadline } from "#/collection-deadline";

export type HeaderFrame = Extract<NormalizedFrame, { type: "header" }>;
export type CompleteFrame = Extract<NormalizedFrame, { type: "complete" }>;
export type RowFrame = Extract<NormalizedFrame, { type: "record" | "point" }>;

/** What the kernel asked for: the mode the batch must answer, and when it must have arrived. */
export interface FrameScope {
  mode: CollectionRequest["mode"];
  deadline: string;
  visitedCursors?: string[];
}

export type FrameLimits = Pick<CollectionLimits, "outputBytes" | "recordBytes" | "records">;

/**
 * Validate an untrusted normalized byte stream one frame at a time. Nothing is
 * accumulated: the consumer's pace is the only thing that pulls bytes from the
 * Gatekeeper, and every limit is enforced before a frame is handed out.
 */
export async function* readFrames(stream: ReadableStream<Uint8Array>, limits: FrameLimits, scope: FrameScope): AsyncGenerator<NormalizedFrame> {
  const deadline = new CollectionDeadline(scope.deadline);
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false });
  const encoder = new TextEncoder();
  const frameBytes = frameBytesFor(limits);
  let carry = "";
  let totalBytes = 0;
  let rows = 0;
  let header: HeaderFrame | undefined;
  let products = new Map<string, ProductDeclaration>();
  let complete = false;
  let finished = false;

  const frameOf = (line: string): NormalizedFrame => {
    if (!line.trim()) throw new NormalizedInputError("Blank normalized frame");
    if (line.length * 3 > frameBytes && encoder.encode(line).byteLength + 1 > frameBytes) {
      throw new NormalizedInputError(`Normalized frame exceeds ${frameBytes} bytes`);
    }
    let parsed;
    try {
      parsed = parseJson(line);
    } catch {
      throw new NormalizedInputError("Gatekeeper normalized stream contained invalid JSON");
    }
    if (!isJsonObject(parsed) || !isNormalizedFrame(parsed)) throw new NormalizedInputError("Gatekeeper normalized stream contained an invalid frame");
    if (complete) throw new NormalizedInputError("Gatekeeper normalized stream continued after completion");
    const untrusted: unknown = parsed;
    // SAFETY: isNormalizedFrame checked the discriminant and every field of this frame variant.
    const frame = untrusted as NormalizedFrame;
    if (frame.type === "header") {
      if (header) throw new NormalizedInputError("Gatekeeper normalized stream contained duplicate headers");
      acceptHeader(frame);
      header = frame;
      products = new Map(frame.products.map((product) => [product.productKey, product]));
      return frame;
    }
    if (!header) throw new NormalizedInputError("Gatekeeper normalized stream omitted its header");
    if (frame.type === "record" || frame.type === "point") {
      rows += 1;
      if (rows > limits.records) throw new NormalizedInputError(`Normalized output exceeds ${limits.records} rows`);
      // The frame line bounds the value; exact bytes are counted only near the limit.
      if (line.length * 3 > limits.recordBytes && encoder.encode(JSON.stringify(frame.value)).byteLength > limits.recordBytes) {
        throw new NormalizedInputError(`Normalized record exceeds ${limits.recordBytes} bytes`);
      }
      const product = products.get(frame.productKey);
      if (!product) throw new NormalizedInputError("Normalized row referred to an unknown product");
      if ((frame.type === "record") !== (product.kind === "record")) throw new NormalizedInputError("Normalized row and product content disagree");
      return frame;
    }
    if (frame.type !== "complete") throw new NormalizedInputError("Gatekeeper normalized stream contained an unknown frame");
    for (const item of frame.products ?? []) if (!products.has(item.productKey)) throw new NormalizedInputError("Completion finalized an undeclared product");
    if (scope.mode.kind === "history") assertHistoryProgress(scope.mode.cursor, frame.nextCursor, frame.exhausted === true, scope.visitedCursors);
    else if (frame.nextCursor !== undefined || frame.exhausted !== undefined) throw new NormalizedInputError("Live collection returned history progress");
    complete = true;
    return frame;
  };

  // One listener for the whole stream instead of a race per read: when the deadline passes, cancelling the reader
  // releases a read that is still waiting on a stalled producer, and the check after it reports the deadline.
  const forget = deadline.onExpiry(() => {
    void reader.cancel("Collection deadline exceeded").catch(() => undefined);
  });
  try {
    while (true) {
      deadline.check();
      const part = await reader.read();
      deadline.check();
      if (part.done) break;
      totalBytes += part.value.byteLength;
      if (totalBytes > limits.outputBytes) throw new NormalizedInputError(`Normalized output exceeds ${limits.outputBytes} bytes`);
      try {
        carry += decoder.decode(part.value, { stream: true });
      } catch {
        throw new NormalizedInputError("Invalid normalized UTF-8");
      }
      let start = 0;
      while (true) {
        const newline = carry.indexOf("\n", start);
        if (newline < 0) break;
        const line = carry.slice(start, newline);
        start = newline + 1;
        yield frameOf(line);
      }
      carry = start > 0 ? carry.slice(start) : carry;
      if (carry.length * 3 > frameBytes && encoder.encode(carry).byteLength > frameBytes) {
        throw new NormalizedInputError(`Normalized frame exceeds ${frameBytes} bytes`);
      }
    }
    try {
      carry += decoder.decode();
    } catch {
      throw new NormalizedInputError("Invalid normalized UTF-8");
    }
    if (carry.trim()) yield frameOf(carry);
    if (!header || !complete) throw new NormalizedInputError("Gatekeeper normalized stream was truncated before completion");
    finished = true;
  } finally {
    forget();
    deadline.close();
    // Cancellation never awaits an uncooperative producer.
    if (!finished) void reader.cancel("Normalized stream rejected").catch(() => undefined);
    else reader.releaseLock();
  }
}

function acceptHeader(frame: HeaderFrame): void {
  if (frame.products.length > MAX_PRODUCTS) throw new NormalizedInputError(`Normalized output exceeds ${MAX_PRODUCTS} products`);
  if (new Set(frame.products.map((product) => product.productKey)).size !== frame.products.length) throw new NormalizedInputError("Duplicate product key");
  if (new Set(frame.products.map((product) => product.slug)).size !== frame.products.length) throw new NormalizedInputError("Duplicate product slug");
}
