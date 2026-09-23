/** DGEG's fuel-price service, read once for every feed that needs it. */
export { DGEG_NORMALIZER, DGEG_TRANSFORMER, resolveDgegFeed, type DgegContext } from "./collector";
export { DGEG_API_ORIGIN, DGEG_FEEDS, FUEL_PRICES_MAX_BYTES, FUEL_TYPES_MAX_BYTES, collectDgegFeed, dgegDateTime, validateDgegFeedConfig } from "./dgeg";
export { DgegTransformer } from "./transform";
export { DGEG_DEPLOYMENT } from "./deployment";
