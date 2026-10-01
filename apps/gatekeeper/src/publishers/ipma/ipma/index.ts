/** IPMA's open-data endpoints, read once for every feed that needs them. */
export {
  IPMA_DATASET_NORMALIZER,
  IPMA_DATASET_TRANSFORMER,
  IPMA_LIGHTNING_NORMALIZER,
  IPMA_LIGHTNING_TRANSFORMER,
  IPMA_NORMALIZER,
  IPMA_TRANSFORMER,
  resolveIpmaFeed,
  type IpmaContext,
} from "./collector";
export { IPMA_LIGHTNING_MAX_BYTES, IPMA_LIGHTNING_PAGE, IPMA_WEB_ORIGIN, IpmaLightningTransformer, collectIpmaLightning } from "./lightning";
export { IPMA_FEEDS, IPMA_FEED_LIMITS, collectIpmaFeed, validateIpmaFeedConfig, type IpmaFeedName } from "./ipma";
export { IpmaTransformer } from "./transform";
export { IpmaDatasetTransformer } from "./datasets";
export { IPMA_DEPLOYMENT } from "./deployment";
