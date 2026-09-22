import { allowedHosts, resolveFeed, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { CKAN_FEEDS, CkanSource, validateCkanFeedConfig, type CkanResourceMetadata } from "./ckan";
import { CKAN_NORMALIZER, transformCkan } from "./transform";

/** What a Worker hands this library: the feed's configuration, its allowlist, and the fetch it may use. */
export interface CkanCollectorOptions {
  config: SourceConfig;
  /** `CKAN_ALLOWED_HOSTS`, comma-separated. */
  hosts: string;
  fetcher: typeof fetch;
}

export function resolveCkanFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, {
    library: "ckan",
    kinds: [config.measures ? CKAN_FEEDS.observations : CKAN_FEEDS.resource],
    validate: (value) => validateCkanFeedConfig(value, hosts),
  });
}

/**
 * The collection wiring. The source fetch hands the transform its resource
 * metadata through this closure, because a `SourceBody` carries only bytes.
 */
export function ckanCollector(options: CkanCollectorOptions): NormalizedCollector {
  const hosts = allowedHosts(options.hosts);
  let metadata: CkanResourceMetadata | undefined;
  return {
    normalizer: CKAN_NORMALIZER,
    resolve: (value) => resolveCkanFeed(value, hosts),
    source: async (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("CKAN history is not supported");
      const source = new CkanSource(hosts, (input, init) => options.fetcher(input, { ...init, signal }));
      const collected = await source.collect(options.config, sourceValidator(state));
      metadata = collected.metadata;
      return collected.fetch;
    },
    normalize: {
      kind: "streaming",
      transform: (body, context) => {
        if (!metadata) throw new Error("CKAN resource metadata did not accompany the source body");
        return transformCkan(body, context, metadata);
      },
    },
  };
}
