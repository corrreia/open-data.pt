/** OGC API — Features collections, parsed once for every Worker that reads one. */
export { ogcCollector, resolveOgcFeed, type OgcCollectorOptions } from "./collector";
export { OGC_EXAMPLES } from "./examples";
export {
  MAX_METADATA_BYTES, OGC_FEEDS, collectOgcFeed, collectionUrl, itemsUrl, validateOgcFeedConfig,
  type Fetcher, type OgcCollectionDescription, type OgcProperty,
} from "./ogc";
export { MAX_FEATURE_BYTES, MAX_RECORD_BYTES, OgcTransformer } from "./transform";
