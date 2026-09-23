/** uData portals (dados.gov.pt), parsed once for every feed that reads one. */
export { UDATA_FEEDS, UDATA_NORMALIZER, UDATA_TRANSFORMER, collectUdataFeed, resolveUdataFeed, type UdataContext } from "./collector";
export { validateUdataFeedConfig } from "./config";
export { chooseTransformer, transformUdata } from "./transform";
export { UdataSource, type DistributionSelector, validateUdataSourceConfig, type Fetcher } from "./udata";
export { UDATA_DEPLOYMENT } from "./deployment";
