/** OGC API — Features collections, parsed once for every feed that reads one. */
export { OGC_NORMALIZER, OGC_TRANSFORMER, resolveOgcFeed, type OgcContext } from "./collector";
export {
  MAX_METADATA_BYTES,
  OGC_FEEDS,
  collectOgcFeed,
  collectionUrl,
  itemsUrl,
  validateOgcFeedConfig,
  type Fetcher,
  type OgcCollectionDescription,
  type OgcProperty,
} from "./ogc";
export { MAX_FEATURE_BYTES, MAX_RECORD_BYTES, OgcTransformer } from "./transform";
export { OGC_DEPLOYMENT } from "./deployment";
