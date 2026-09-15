/** Carris Metropolitana's own API, read once for every Worker that needs it. */
export { CARRIS_FEEDS, collectCarrisFeed, validateCarrisFeedConfig } from "./carris";
export { carrisCollector, resolveCarrisFeed, type CarrisCollectorOptions } from "./collector";
export { CARRIS_EXAMPLES } from "./examples";
export { CarrisTransformer } from "./transform";
