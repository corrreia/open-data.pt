import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { WFS_FEEDS, collectWfsFeed, validateWfsFeedConfig, wfsHosts } from "./wfs";
import { WfsTransformer } from "./transform";

export interface WfsCollectorOptions {
  config: SourceConfig;
  hosts: string;
  fetcher: typeof fetch;
  now?: () => Date;
}

const transformer = new WfsTransformer();

export function resolveWfsFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "wfs", kinds: WFS_FEEDS, validate: (value) => validateWfsFeedConfig(value, hosts) });
}

export function wfsCollector(options: WfsCollectorOptions): NormalizedCollector {
  const hosts = wfsHosts(options.hosts);
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (config) => resolveWfsFeed(config, hosts),
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("WFS history is not exposed by this rolling-window feed");
      return collectWfsFeed(options.config, sourceValidator(state), hosts, (input, init) => options.fetcher(input, { ...init, signal }), options.now?.() ?? new Date());
    },
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
