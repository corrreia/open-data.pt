import { allowedHosts, resolveFeed, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { OGC_FEEDS, collectOgcFeed, validateOgcFeedConfig } from "./ogc";
import { OgcTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, its allowlist, and the fetch it may use. */
export interface OgcCollectorOptions {
  config: SourceConfig;
  /** `OGC_ALLOWED_HOSTS`, comma-separated. */
  hosts: string;
  fetcher: typeof fetch;
}

export function resolveOgcFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, {
    library: "ogc",
    kinds: OGC_FEEDS,
    validate: (value) => validateOgcFeedConfig(value, hosts),
    // Page size and page cap change how much of a collection is read, not which
    // collection it is; two feeds that differ only there are the same resource.
    resourceConfig: (value) => {
      const identity: SourceConfig = { host: value.host ?? "", collection: value.collection ?? "", geometry: value.geometry ?? "include" };
      if (value.basePath) identity.basePath = value.basePath;
      if (value.properties) identity.properties = value.properties;
      return identity;
    },
  });
}

const transformer = new OgcTransformer();

/** The whole OGC API Features collection: typed source fetch plus the streaming feature normalizer. */
export function ogcCollector(options: OgcCollectorOptions): NormalizedCollector {
  const hosts = allowedHosts(options.hosts);
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveOgcFeed(value, hosts),
    source: (state, mode, signal) => {
      // Neither service publishes anything but its current release: there is no
      // older slice to walk, so history is never claimed and never attempted.
      if (mode.kind === "history") throw new Error("OGC API Features history is not supported");
      return collectOgcFeed(options.config, state, hosts, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "streaming", transform: (body, context) => transformer.transform(body, context) },
  };
}
