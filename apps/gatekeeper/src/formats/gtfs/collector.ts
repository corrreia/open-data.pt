import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { GTFS_FEEDS, validateGtfsFeedConfig } from "./gtfs";

/** What a GTFS feed's functions are handed when they run: the hosts its publishers' feeds name, comma-separated, the only ones it may fetch. */
export interface GtfsContext {
  hosts: string;
}

export function resolveGtfsFeed(config: SourceConfig, hosts: string): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "gtfs", kinds: GTFS_FEEDS, validate: (value) => validateGtfsFeedConfig(value, hosts) });
}
