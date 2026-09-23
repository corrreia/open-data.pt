/** Carris Metropolitana's own API, read once for every feed that needs it. */
export { CARRIS_FEEDS, collectCarrisFeed, validateCarrisFeedConfig } from "./carris";
export { CARRIS_NORMALIZER, CARRIS_TRANSFORMER, resolveCarrisFeed, type CarrisContext } from "./collector";
export { CarrisTransformer } from "./transform";
export { CARRIS_DEPLOYMENT } from "./deployment";
