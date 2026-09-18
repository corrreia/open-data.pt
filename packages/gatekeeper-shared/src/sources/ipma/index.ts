/** IPMA's open-data endpoints, read once for every feed that needs them. */
export { ipmaCollector, resolveIpmaFeed, type IpmaCollectorOptions } from "./collector";
export { IPMA_EXAMPLES } from "./examples";
export { IPMA_FEEDS, IPMA_FEED_LIMITS, collectIpmaFeed, validateIpmaFeedConfig, type IpmaFeedName } from "./ipma";
export { IpmaTransformer } from "./transform";
export { IPMA_DEPLOYMENT } from "./worker";
