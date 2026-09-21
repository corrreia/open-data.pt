import { allowedHosts, resolveFeed, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { STAC_FEEDS, collectStacFeed, validateStacFeedConfig } from "./stac";
import { StacTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, its allowlist, and the fetch it may use. */
export interface StacCollectorOptions {
  config: SourceConfig;
  /** `STAC_ALLOWED_HOSTS`, comma-separated. */
  hosts: string;
  fetcher: typeof fetch;
}

export function resolveStacFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, {
    library: "stac",
    kinds: STAC_FEEDS,
    validate: (value) => validateStacFeedConfig(value, hosts),
    // How much of a collection is read is not which collection it is.
    resourceConfig: (value) => {
      const identity: SourceConfig = { host: value.host ?? "", collection: value.collection ?? "" };
      if (value.basePath) identity.basePath = value.basePath;
      return identity;
    },
  });
}

const transformer = new StacTransformer();

/** One STAC collection: typed source fetch plus the streaming item normalizer. */
export function stacCollector(options: StacCollectorOptions): NormalizedCollector {
  const hosts = allowedHosts(options.hosts);
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveStacFeed(value, hosts),
    source: (state, mode, signal) => {
      // A catalogue publishes what it holds now; there is no older edition of it
      // to walk, and the coverages themselves are each their own collection.
      if (mode.kind === "history") throw new Error("STAC history is not supported");
      return collectStacFeed(options.config, state, hosts, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "streaming", transform: (body, context) => transformer.transform(body, context) },
  };
}
