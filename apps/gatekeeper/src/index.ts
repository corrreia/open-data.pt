/*
 * What a library may use: the contract, and the Gatekeeper's own collector,
 * HTTP and stream helpers. A library imports from here and nowhere else in the
 * Worker; the kernel never imports from here at all.
 */
export * from "@open-data-pt/catalog";
export * from "@open-data-pt/contract";
export {
  SOURCE_KEY,
  buildLibrary,
  libraryCollector,
  libraryConfig,
  libraryFeedKinds,
  resolveLibraryFeed,
  type GatekeeperLibraries,
  type GatekeeperLibrary,
  type Library,
  type LibraryDeployment,
  type R2BucketDeployment,
} from "./library";
export { lisbonDay, lisbonInstants, lisbonOffsetMinutes, lisbonToUtc } from "@open-data-pt/lisbon";
export { r2Staging, type SourceStaging } from "./staging";
export { BUFFERED_SOURCE_MAX_BYTES, bufferedTransform, collectNormalized, resolveFeed, responseValidator, sourceValidator, type NormalizedCollector } from "./normalized";
export {
  allowedHosts,
  contentEtag,
  equivalentEtags,
  fixedOrigin,
  hashString,
  invalidResponse,
  isoDate,
  readBoundedJson,
  readBoundedResponse,
  retryAfterSeconds,
  sha256Hex,
} from "./source-http";
export { readBoundedBytes, toByteStream } from "./stream";
export { streamCsvRecords, streamCsvRows, type CsvStreamOptions } from "./stream-csv";
export { streamJsonArray, streamNdjson, type JsonArrayPath, type JsonArrayStream, type JsonArrayStreamOptions } from "./stream-json";
export { field, runTransformer, type Transformer, type UnstampedResult } from "./transformer";
