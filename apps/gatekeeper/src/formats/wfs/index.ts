/** OGC Web Feature Services, read once for every feed that reads one. */
export { WFS_DEPLOYMENT } from "./deployment";
export { WFS_FEEDS, WFS_MAX_BYTES, collectWfsFeed, validateWfsFeedConfig, wfsHosts, type WfsConfig } from "./wfs";
export { WFS_NORMALIZER, WFS_TRANSFORMER, resolveWfsFeed, type WfsContext } from "./collector";
export { WfsTransformer } from "./transform";
