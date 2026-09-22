/*
 * What a library may use: the contract, the catalog's vocabularies, and the
 * Gatekeeper's own collector, HTTP and stream helpers. It never re-exports the
 * catalog itself (`./catalog`), which imports the publisher folders, which import
 * the libraries: that would be a cycle. A library imports from here and nowhere else in the
 * Worker; the kernel never imports from here at all.
 */
export { LICENCES, isLicence, type Licence, type LicenceDescription } from "./catalog/licences";
export { TOPICS, isTopic, type Topic } from "./catalog/topics";
export type { DatasetDefinition, FeedDefinition, PublisherDefinition } from "./catalog/define";
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
