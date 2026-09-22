import { resolveFeed, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "#/index";
import { GBFS_FEEDS, allowedGbfsHosts, collectGbfsFeed, validateGbfsFeedConfig } from "./gbfs";
import { GbfsTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, its allowlist, and the fetch it may use. */
export interface GbfsCollectorOptions {
  config: SourceConfig;
  /** The hosts its publishers' feeds name, comma-separated: the only ones it may fetch. */
  hosts: string;
  fetcher: typeof fetch;
}

const transformer = new GbfsTransformer();

export function resolveGbfsFeed(config: SourceConfig, hosts: string): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "gbfs", kinds: GBFS_FEEDS, validate: (value) => validateGbfsFeedConfig(value, allowedGbfsHosts(hosts)) });
}

/** One discovery document and the station files it names, buffered whole and translated together. */
export function gbfsCollector(options: GbfsCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveGbfsFeed(value, options.hosts),
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("GBFS history is not supported");
      return collectGbfsFeed(options.config, sourceValidator(state), options.hosts, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "buffered", transform: (bytes, context) => transformer.transform(bytes, context) },
  };
}
