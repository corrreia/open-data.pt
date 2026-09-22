import {
  NormalizedInputError,
  GatekeeperError,
  assertHistoryProgress,
  assertResolvedFeed,
  NORMALIZED_PROTOCOL,
  type CollectionRequest,
  type CollectionResult,
  type Completeness,
  type FeedKindDescription,
  type JsonObject,
  type NormalizedFrame,
  type NormalizedProductHeader,
  type NormalizedRow,
  type ProductDeclaration,
  type ResolvedFeed,
  type SourceBody,
  type SourceCheckpoint,
  type SourceConfig,
  type SourceFetch,
  type SourceValidator,
  type StreamingTransform,
  type TransformContext,
  type TransformResult,
} from "./index";
import { assertSourceCheckpoint, canonicalSourceConfig, hashSourceConfig, isJsonObject, isJsonString } from "@open-data-pt/contract";
import { limitBytes, readBoundedBytes, toByteStream } from "./stream";

/**
 * Formats that cannot stream are buffered whole inside the Gatekeeper. They stay
 * under this cap whatever the feed policy says, so one isolate never holds more.
 */
export const BUFFERED_SOURCE_MAX_BYTES = 16 * 1024 * 1024;

/** How a Gatekeeper turns source bytes into normalized rows. */
type Normalizer =
  | { kind: "buffered"; transform: (bytes: Uint8Array, context: TransformContext) => TransformResult | Promise<TransformResult> }
  | { kind: "streaming"; transform: (body: ReadableStream<Uint8Array>, context: TransformContext) => StreamingTransform | Promise<StreamingTransform> };

export interface NormalizedCollector {
  normalizer: { id: string; version: string };
  resolve: (config: SourceConfig) => ResolvedFeed | Promise<ResolvedFeed>;
  /** Receives the complete compatible source-owned state, not one guessed validator. */
  source: (state: JsonObject | undefined, mode: CollectionRequest["mode"], signal: AbortSignal) => Promise<SourceFetch>;
  normalize: Normalizer;
}

interface ResolveFeedOptions {
  library: string;
  kinds: Readonly<Record<string, FeedKindDescription>> | readonly FeedKindDescription[];
  validate: (config: SourceConfig) => SourceConfig | Promise<SourceConfig>;
  resourceConfig?: (config: SourceConfig, kind: FeedKindDescription) => SourceConfig;
}

/** Canonical source resolution lives at the Gatekeeper boundary, never in the kernel. */
export async function resolveFeed(config: SourceConfig, options: ResolveFeedOptions): Promise<ResolvedFeed> {
  const canonical = await options.validate(config);
  const kinds = Array.isArray(options.kinds) ? options.kinds : Object.values(options.kinds);
  const kindName = canonical.feed ?? (kinds.length === 1 ? kinds[0]?.kind : undefined);
  const kind = kinds.find((candidate) => candidate.kind === kindName);
  if (!kind) throw new GatekeeperError(`Unsupported feed kind: ${kindName ?? "(unspecified)"}`, "invalid-config");
  const identity = options.resourceConfig?.(canonical, kind) ?? canonical;
  const [configHash, identityHash] = await Promise.all([hashSourceConfig(canonical), hashSourceConfig(identity)]);
  const resourceKey = `${options.library}:${kind.kind}:${identityHash}`;
  const resolved: ResolvedFeed = { config: canonical, configHash, resourceKey, kind: kind.kind, semantics: kind.semantics };
  if (kind.history) resolved.history = kind.history;
  return resolved;
}

/** The transport validators a checkpoint carries, for HTTP and compound-source adapters. */
export function sourceValidator(state: JsonObject | undefined): SourceValidator | undefined {
  const validators = isJsonObject(state?.validators) ? state.validators : undefined;
  const value = validators && isJsonObject(validators.default) ? validators.default : undefined;
  if (!value) return undefined;
  const validator: SourceValidator = {};
  if (isJsonString(value.etag)) validator.etag = value.etag;
  if (isJsonString(value.lastModified)) validator.lastModified = value.lastModified;
  return Object.keys(validator).length ? validator : undefined;
}

function withSourceValidator(state: JsonObject | undefined, validator: SourceValidator): JsonObject {
  const validators = isJsonObject(state?.validators) ? { ...state.validators } : {};
  validators.default = { ...validator };
  return { ...state, validators };
}

/** The transport validators an upstream HTTP response carries, for adapters that forward them. */
export function responseValidator(headers: Headers): SourceValidator | undefined {
  const validator: SourceValidator = {};
  const etag = headers.get("etag");
  const lastModified = headers.get("last-modified");
  if (etag) validator.etag = etag;
  if (lastModified) validator.lastModified = lastModified;
  return Object.keys(validator).length ? validator : undefined;
}

/** Keep source bytes inside the Gatekeeper and expose only a typed v3 result. */
export async function collectNormalized(request: CollectionRequest, collector: NormalizedCollector): Promise<CollectionResult> {
  try {
    return await collect(request, collector);
  } catch (error) {
    if (error instanceof GatekeeperError) {
      const failure: Extract<CollectionResult, { kind: "failure" }> = { kind: "failure", code: error.code, retryable: error.code === "upstream-error" };
      if (error.retryAfterSeconds !== undefined) failure.retryAfterSeconds = error.retryAfterSeconds;
      return failure;
    }
    if (error instanceof NormalizedInputError) return { kind: "failure", code: "invalid-response", retryable: false };
    // The kernel and this Gatekeeper are different releases: a deploy in progress, over in a minute.
    if (error instanceof ProtocolMismatch) return { kind: "failure", code: "protocol-mismatch", retryable: true, retryAfterSeconds: 60 };
    if (error instanceof Error && /deadline/i.test(error.message)) return { kind: "failure", code: "deadline-exceeded", retryable: true };
    throw error;
  }
}

class ProtocolMismatch extends Error {
  constructor(requested: string) {
    super(`The kernel asked for ${requested}; this Gatekeeper speaks ${NORMALIZED_PROTOCOL}`);
    this.name = "ProtocolMismatch";
  }
}

async function collect(request: CollectionRequest, collector: NormalizedCollector): Promise<CollectionResult> {
  validateRequest(request);
  const resolved = await collector.resolve(request.resolved.config);
  assertResolvedFeed(resolved);
  assertResolvedFeed(request.resolved);
  if (canonicalResolved(resolved) !== canonicalResolved(request.resolved)) {
    return { kind: "failure", code: "invalid-config", retryable: false };
  }
  if (request.mode.kind === "history" && !resolved.history) return { kind: "failure", code: "history-unsupported", retryable: false };
  const configHash = await hashSourceConfig(resolved.config);
  if (resolved.configHash !== configHash) return { kind: "failure", code: "invalid-config", retryable: false };
  const compatible =
    request.checkpoint?.version === 2 &&
    request.checkpoint.resourceKey === resolved.resourceKey &&
    request.checkpoint.configHash === configHash &&
    request.checkpoint.feedEpoch === request.feedEpoch &&
    request.checkpoint.normalizer.id === collector.normalizer.id &&
    request.checkpoint.normalizer.version === collector.normalizer.version;
  const previousState = compatible ? request.checkpoint?.state : undefined;
  const aborter = new AbortController();
  const abort = () => aborter.abort("Collection deadline exceeded");
  let fetched: SourceFetch;
  try {
    fetched = await beforeDeadline(collector.source(previousState, request.mode, aborter.signal), request.deadline, abort);
  } catch (error) {
    if (error instanceof GatekeeperError) throw error;
    if (aborter.signal.aborted) return { kind: "failure", code: "deadline-exceeded", retryable: true };
    throw error;
  }

  const checkpoint = checkpointFrom(request, collector.normalizer, configHash, previousState, fetched);
  assertSourceCheckpoint(checkpoint);
  if (fetched.kind === "not-modified") {
    if (request.mode.kind === "history") throw new NormalizedInputError("History cannot report unchanged");
    return { kind: "unchanged", checkpoint };
  }
  if (fetched.kind === "exhausted") {
    if (request.mode.kind === "live") throw new NormalizedInputError("Live collection cannot report history exhaustion");
    return { kind: "exhausted" };
  }

  if (request.mode.kind === "history") assertHistoryProgress(request.mode.cursor, fetched.next, fetched.exhausted === true);
  else if (fetched.next || fetched.exhausted) throw new NormalizedInputError("Live source returned history progress");

  const context: TransformContext = {
    feed: { slug: request.feed.slug, title: request.feed.title, description: request.feed.description, config: resolved.config, semantics: resolved.semantics },
    observedAt: request.observedAt,
  };

  let transform: StreamingTransform;
  try {
    transform = await beforeDeadline(normalize(collector, fetched, request, context), request.deadline, abort);
  } catch (error) {
    if (error instanceof GatekeeperError || error instanceof NormalizedInputError) throw error;
    if (aborter.signal.aborted) return { kind: "failure", code: "deadline-exceeded", retryable: true };
    throw new NormalizedInputError(`Normalizer failed: ${String(error)}`);
  }
  if (transform.products.length > request.limits.products) throw new NormalizedInputError(`Normalized output exceeds ${request.limits.products} products`);
  const productKeys = new Set(transform.products.map((product) => product.productKey));
  if (productKeys.size !== transform.products.length) throw new NormalizedInputError("Normalizer produced duplicate product keys");

  const header: Extract<NormalizedFrame, { type: "header" }> = {
    type: "header",
    protocol: NORMALIZED_PROTOCOL,
    collectionId: request.collectionId,
    normalizer: collector.normalizer,
    products: transform.products.map((product) => productHeader(product, fetched.completeness)),
    provenance: provenanceFrom(fetched),
    completeness: fetched.completeness,
    checkpoint,
  };
  return { kind: "batch", stream: frameStream(request, header, transform, fetched, productKeys, aborter) };
}

async function normalize(collector: NormalizedCollector, fetched: SourceBody, request: CollectionRequest, context: TransformContext): Promise<StreamingTransform> {
  if (collector.normalize.kind === "streaming") {
    return collector.normalize.transform(limitBytes(toByteStream(fetched.body), request.limits.sourceBytes), context);
  }
  const bytes = await readBoundedBytes(fetched.body, Math.min(request.limits.sourceBytes, BUFFERED_SOURCE_MAX_BYTES));
  const result = await collector.normalize.transform(bytes, context);
  if (result.transformer.id !== collector.normalizer.id || result.transformer.version !== collector.normalizer.version) {
    throw new NormalizedInputError("Normalizer identity did not match its checkpoint contract");
  }
  return bufferedTransform(result);
}

/** Present a buffered result through the same pull interface a streaming normalizer uses. */
export function bufferedTransform(result: TransformResult): StreamingTransform {
  return {
    products: result.products.map((product): ProductDeclaration => {
      const declaration: ProductDeclaration = {
        productKey: product.productKey,
        slug: product.slug,
        title: product.title,
        description: product.description,
        role: product.role,
        kind: product.kind,
        schema: product.schema,
        updateMode: product.updateMode,
        completeness: product.completeness,
      };
      if (product.watermark) declaration.watermark = product.watermark;
      return declaration;
    }),
    rows: bufferedRows(result),
    finish: () => ({ quality: result.quality }),
  };
}

async function* bufferedRows(result: TransformResult): AsyncGenerator<NormalizedRow> {
  for (const product of result.products) {
    if (product.kind === "record") {
      for (const record of product.records) yield { productKey: product.productKey, record };
    } else {
      for (const point of product.points) yield { productKey: product.productKey, point };
    }
  }
}

function productHeader(product: ProductDeclaration, sourceCompleteness: Completeness): NormalizedProductHeader {
  const completeness: Completeness =
    sourceCompleteness === "partial" || product.completeness === "partial"
      ? "partial"
      : sourceCompleteness === "unknown" || product.completeness === "unknown"
        ? "unknown"
        : "complete";
  const header: NormalizedProductHeader = {
    productKey: product.productKey,
    suggestedSlug: product.slug,
    title: product.title,
    description: product.description,
    role: product.role,
    schema: product.schema,
    kind: product.kind,
    updateMode: product.updateMode,
    completeness,
  };
  if (product.watermark) header.watermark = product.watermark;
  return header;
}

/**
 * One frame per pull: the kernel's read rate is the only thing that advances
 * the normalizer, so neither side ever buffers the whole dataset.
 */
function frameStream(
  request: CollectionRequest,
  header: Extract<NormalizedFrame, { type: "header" }>,
  transform: StreamingTransform,
  fetched: SourceBody,
  productKeys: Set<string>,
  aborter: AbortController,
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const rows = transform.rows[Symbol.asyncIterator]();
  const kinds = new Map(transform.products.map((product) => [product.productKey, product.kind]));
  let phase: "header" | "rows" | "done" = "header";
  let outputBytes = 0;
  let records = 0;
  let points = 0;
  const deadline = Date.parse(request.deadline);
  const emit = (controller: ReadableByteStreamController, line: string): void => {
    const bytes = encoder.encode(`${line}\n`);
    if (bytes.byteLength > request.limits.frameBytes) throw new NormalizedInputError(`Normalized frame exceeds ${request.limits.frameBytes} bytes`);
    outputBytes += bytes.byteLength;
    if (outputBytes > request.limits.outputBytes) throw new NormalizedInputError(`Normalized output exceeds ${request.limits.outputBytes} bytes`);
    controller.enqueue(bytes);
  };
  return new ReadableStream({
    type: "bytes",
    async pull(controller) {
      try {
        if (Date.now() > deadline) throw new Error("Collection deadline exceeded");
        if (phase === "header") {
          phase = "rows";
          emit(controller, JSON.stringify(header));
          return;
        }
        if (phase === "done") {
          controller.close();
          return;
        }
        const next = await rows.next();
        if (!next.done) {
          const row = next.value;
          if (!productKeys.has(row.productKey)) throw new NormalizedInputError("Normalizer produced a row for an undeclared product");
          const expected = kinds.get(row.productKey);
          if (row.record !== undefined) {
            if (expected !== "record") throw new NormalizedInputError("Normalizer produced a record for a series product");
            records += 1;
            emit(controller, encodeRow("record", row.productKey, row.record, request, records + points));
          } else {
            if (expected !== "series") throw new NormalizedInputError("Normalizer produced a point for a record product");
            points += 1;
            emit(controller, encodeRow("point", row.productKey, row.point, request, records + points));
          }
          return;
        }
        const summary = transform.finish();
        const complete: Extract<NormalizedFrame, { type: "complete" }> = { type: "complete", counts: { records, points }, quality: summary.quality };
        if (summary.products?.length) complete.products = summary.products;
        if (fetched.next) complete.nextCursor = fetched.next;
        if (fetched.exhausted) complete.exhausted = true;
        emit(controller, JSON.stringify(complete));
        phase = "done";
      } catch (error) {
        aborter.abort(error);
        void rows.return?.(undefined);
        controller.error(error);
      }
    },
    cancel(reason) {
      aborter.abort(reason);
      void rows.return?.(undefined);
    },
  });
}

function encodeRow(type: "record" | "point", productKey: string, value: NormalizedRow["record"] | NormalizedRow["point"], request: CollectionRequest, rows: number): string {
  if (rows > request.limits.records) throw new NormalizedInputError(`Normalized output exceeds ${request.limits.records} rows`);
  const encoded = JSON.stringify(value);
  // UTF-16 length is a cheap upper-bound check first; exact bytes only when it matters.
  if (encoded.length * 3 > request.limits.recordBytes && new TextEncoder().encode(encoded).byteLength > request.limits.recordBytes) {
    throw new NormalizedInputError(`Normalized record exceeds ${request.limits.recordBytes} bytes`);
  }
  return `{"type":"${type}","productKey":${JSON.stringify(productKey)},"value":${encoded}}`;
}

function validateRequest(request: CollectionRequest): void {
  if (request.protocol !== NORMALIZED_PROTOCOL) throw new ProtocolMismatch(request.protocol);
  if (!request.collectionId || !request.feedEpoch || !request.resolved.resourceKey || !request.feed.id || !request.feed.slug) throw new Error("Collection identity is required");
  if (Number.isNaN(Date.parse(request.deadline)) || Date.parse(request.deadline) <= Date.now()) throw new Error("Collection deadline is invalid or expired");
  if (Number.isNaN(Date.parse(request.observedAt))) throw new Error("Observation time is invalid");
  for (const [name, value] of Object.entries(request.limits))
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`Collection limit ${name} must be a positive integer`);
  if (request.limits.recordBytes > request.limits.frameBytes || request.limits.frameBytes > request.limits.outputBytes)
    throw new Error("Collection limits must satisfy recordBytes <= frameBytes <= outputBytes");
}

function checkpointFrom(
  request: CollectionRequest,
  normalizer: { id: string; version: string },
  configHash: string,
  previous: JsonObject | undefined,
  fetched: SourceFetch,
): SourceCheckpoint {
  const validator = fetched.kind === "exhausted" ? undefined : fetched.validator;
  const owned = fetched.kind === "body" ? fetched.state : undefined;
  const state = owned ?? (validator ? withSourceValidator(previous, validator) : (previous ?? {}));
  return { version: 2, resourceKey: request.resolved.resourceKey, configHash, feedEpoch: request.feedEpoch, normalizer, state };
}

function provenanceFrom(fetched: SourceBody): Extract<NormalizedFrame, { type: "header" }>["provenance"] {
  const value: Extract<NormalizedFrame, { type: "header" }>["provenance"] = { sourceUrl: fetched.provenance.sourceUrl || "unknown:" };
  const published = fetched.provenance.sourcePublishedAt;
  if (published && !Number.isNaN(Date.parse(published))) value.sourcePublishedAt = new Date(published).toISOString();
  return value;
}

function canonicalResolved(value: ResolvedFeed): string {
  return JSON.stringify({
    config: JSON.parse(canonicalSourceConfig(value.config)),
    configHash: value.configHash,
    resourceKey: value.resourceKey,
    kind: value.kind,
    semantics: value.semantics,
    history: value.history ?? null,
  });
}

async function beforeDeadline<T>(promise: Promise<T>, deadline: string, onTimeout?: () => void): Promise<T> {
  const remaining = Date.parse(deadline) - Date.now();
  if (remaining <= 0) throw new Error("Collection deadline exceeded");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          onTimeout?.();
          reject(new Error("Collection deadline exceeded"));
        }, remaining);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
