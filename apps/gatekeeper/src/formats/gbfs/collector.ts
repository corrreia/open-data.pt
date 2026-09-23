import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { GBFS_FEEDS, allowedGbfsHosts, validateGbfsFeedConfig } from "./gbfs";
import { GbfsTransformer } from "./transform";

/** What a GBFS feed's functions are handed when they run: the hosts its publishers' feeds name, comma-separated, the only ones it may fetch. */
export interface GbfsContext {
  hosts: string;
}

/** The translator from a system's discovery document and station files into products; every GBFS feed uses it. */
export const GBFS_TRANSFORMER = new GbfsTransformer();

/** The normalizer a GBFS feed's collection is stamped with: the translator's name and version. */
export const GBFS_NORMALIZER = { id: GBFS_TRANSFORMER.id, version: GBFS_TRANSFORMER.version };

export function resolveGbfsFeed(config: SourceConfig, hosts: string): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "gbfs", kinds: GBFS_FEEDS, validate: (value) => validateGbfsFeedConfig(value, allowedGbfsHosts(hosts)) });
}
