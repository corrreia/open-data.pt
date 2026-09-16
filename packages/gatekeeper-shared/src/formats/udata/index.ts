/** uData portals (dados.gov.pt), parsed once for every Worker that reads one. */
export { UDATA_FEEDS, resolveUdataFeed, udataCollector, type UdataCollectorOptions } from "./collector";
export { validateUdataFeedConfig } from "./config";
export { UDATA_EXAMPLES } from "./examples";
export { chooseTransformer, listTransformers, transformUdata } from "./transform";
export { UdataSource, validateUdataSourceConfig, type Fetcher } from "./udata";
export { UDATA_DEPLOYMENT } from "./worker";
