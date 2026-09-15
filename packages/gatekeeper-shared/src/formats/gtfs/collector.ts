import { resolveFeed, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { GTFS_FEEDS, collectGtfsFeed, validateGtfsFeedConfig } from "./gtfs";
import { GTFS_NORMALIZER, transformGtfs } from "./transform";

/** What a Worker hands this library: the feed's configuration, its allowlist, and the fetch it may use. */
export interface GtfsCollectorOptions {
  config: SourceConfig;
  /** `GTFS_ALLOWED_HOSTS`, comma-separated. */
  hosts: string;
  fetcher: typeof fetch;
}

export function resolveGtfsFeed(config: SourceConfig, hosts: string): Promise<ResolvedFeed> {
  return resolveFeed(config, { gatekeeperKind: "gtfs", kinds: GTFS_FEEDS, validate: (value) => validateGtfsFeedConfig(value, hosts) });
}

/** One archive downloaded conditionally, then read entry by entry as the kernel pulls rows. */
export function gtfsCollector(options: GtfsCollectorOptions): NormalizedCollector {
  return {
    normalizer: GTFS_NORMALIZER,
    resolve: (value) => resolveGtfsFeed(value, options.hosts),
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("GTFS history is not supported");
      return collectGtfsFeed(options.config, sourceValidator(state), options.hosts, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "streaming", transform: (body, context) => transformGtfs(body, context) },
  };
}
