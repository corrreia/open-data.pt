import {
  NORMALIZED_PROTOCOL,
  NormalizedInputError,
  assertHistoryProgress,
  isJsonObject,
  isJsonString,
  isNormalizedFrame,
  parseJson,
  type CollectionLimits,
  type CollectionRequest,
  type NormalizedFrame,
  type NormalizedProductHeader,
} from "@open-data-pt/gatekeeper-shared";

import { CollectionDeadline } from "./collection-deadline";

export type HeaderFrame = Extract<NormalizedFrame, { type: "header" }>;
export type CompleteFrame = Extract<NormalizedFrame, { type: "complete" }>;
export type RowFrame = Extract<NormalizedFrame, { type: "record" | "point" }>;

/** What the kernel expects a batch to be about; the header must agree with every field. */
export interface FrameScope {
  collectionId: string;
  resourceKey: string;
  configHash: string;
  feedEpoch: string;
  mode: CollectionRequest["mode"];
  deadline: string;
  visitedCursors?: string[];
}

export type FrameLimits = Pick<CollectionLimits, "outputBytes" | "frameBytes" | "recordBytes" | "records" | "products">;

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
  let carry = "";
  let totalBytes = 0;
  let rows = 0;
  let records = 0;
  let points = 0;
  let header: HeaderFrame | undefined;
  let products = new Map<string, NormalizedProductHeader>();
  let complete = false;
  let finished = false;

  const frameOf = (line: string): NormalizedFrame => {
    if (!line.trim()) throw new NormalizedInputError("Blank normalized frame");
    if (line.length * 3 > limits.frameBytes && encoder.encode(line).byteLength + 1 > limits.frameBytes) {
      throw new NormalizedInputError(`Normalized frame exceeds ${limits.frameBytes} bytes`);
    }
    let parsed;
    try {
      parsed = parseJson(line);
    } catch {
      throw new NormalizedInputError("Gatekeeper normalized stream contained invalid JSON");
    }
    // A Gatekeeper on another release than this kernel is a deploy in progress, over in a minute: a retry, never a cooldown.
    // Decided before the shape check, which would otherwise call the whole header invalid.
    if (isJsonObject(parsed) && parsed.type === "header" && isJsonString(parsed.protocol) && parsed.protocol !== NORMALIZED_PROTOCOL) {
      throw new Error(`Gatekeeper speaks ${parsed.protocol}; this kernel expects ${NORMALIZED_PROTOCOL}`);
    }
    if (!isJsonObject(parsed) || !isNormalizedFrame(parsed)) throw new NormalizedInputError("Gatekeeper normalized stream contained an invalid frame");
    if (complete) throw new NormalizedInputError("Gatekeeper normalized stream continued after completion");
    const untrusted: unknown = parsed;
    // SAFETY: isNormalizedFrame checked the discriminant and every field of this frame variant.
    const frame = untrusted as NormalizedFrame;
    if (frame.type === "header") {
      if (header) throw new NormalizedInputError("Gatekeeper normalized stream contained duplicate headers");
      acceptHeader(frame, limits, scope);
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
      if (frame.type === "record") records += 1;
      else points += 1;
      return frame;
    }
    if (frame.type !== "complete") throw new NormalizedInputError("Gatekeeper normalized stream contained an unknown frame");
    if (frame.counts.records !== records || frame.counts.points !== points) throw new NormalizedInputError("Gatekeeper normalized stream completion counts did not match");
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
      if (carry.length * 3 > limits.frameBytes && encoder.encode(carry).byteLength > limits.frameBytes) {
        throw new NormalizedInputError(`Normalized frame exceeds ${limits.frameBytes} bytes`);
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

function acceptHeader(frame: HeaderFrame, limits: FrameLimits, scope: FrameScope): void {
  if (frame.collectionId !== scope.collectionId) throw new NormalizedInputError("Gatekeeper normalized stream header did not match the request");
  if (
    frame.checkpoint.resourceKey !== scope.resourceKey ||
    frame.checkpoint.configHash !== scope.configHash ||
    frame.checkpoint.feedEpoch !== scope.feedEpoch ||
    frame.checkpoint.normalizer.id !== frame.normalizer.id ||
    frame.checkpoint.normalizer.version !== frame.normalizer.version
  ) {
    throw new NormalizedInputError("Checkpoint scope or normalizer did not match the request");
  }
  if (frame.products.length > limits.products) throw new NormalizedInputError(`Normalized output exceeds ${limits.products} products`);
  if (new Set(frame.products.map((product) => product.productKey)).size !== frame.products.length) throw new NormalizedInputError("Duplicate product key");
  if (new Set(frame.products.map((product) => product.suggestedSlug)).size !== frame.products.length) throw new NormalizedInputError("Duplicate product slug");
}
