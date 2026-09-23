/** INE's indicator API, read once for every feed that needs it. */
export { INE_NORMALIZER, resolveIneFeed, type IneContext } from "./collector";
export { INE_FEEDS, INE_HISTORY_MAX_BYTES, INE_MAX_BYTES, collectIneIndicator, collectIneIndicatorHistory, validateIneFeedConfig } from "./ine";
export { transformIneIndicator } from "./transform";
export { INE_DEPLOYMENT } from "./deployment";
