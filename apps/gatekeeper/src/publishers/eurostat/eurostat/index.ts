/** Eurostat's JSON-stat datasets, read once for every feed that needs them. */
export { EUROSTAT_NORMALIZER, eurostatCollector, resolveEurostatFeed, type EurostatCollectorOptions } from "./collector";
export { EUROSTAT_FEEDS, EUROSTAT_HISTORY_MAX_BYTES, EUROSTAT_MAX_BYTES, collectEurostatDataset, collectEurostatDatasetHistory, validateEurostatFeedConfig } from "./eurostat";
export { normalizeEurostatPeriod, transformEurostatDataset, validateEurostatDatasetStructure } from "./transform";
export { EUROSTAT_DEPLOYMENT } from "./deployment";
