/** Opendatasoft Explore catalogs, parsed once for every feed that reads one. */
export { opendatasoftCollector, resolveOpendatasoftFeed, type OpendatasoftCollectorOptions } from "./collector";
export {
  HISTORY_SLICE_SECONDS,
  MAX_HISTORY_DOCUMENT_BYTES,
  MAX_HISTORY_RECORDS,
  MAX_METADATA_BYTES,
  MAX_PAGE_BYTES,
  OPENDATASOFT_FEEDS,
  OpendatasoftSource,
  validateOpendatasoftFeedConfig,
  type Fetcher,
} from "./opendatasoft";
export { OpendatasoftTransformer, SAMPLE_CHARACTERS, SAMPLE_ROWS, seriesSlug } from "./transform";
export { OPENDATASOFT_DEPLOYMENT } from "./deployment";
