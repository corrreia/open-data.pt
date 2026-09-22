import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "#/index";
import { NGSI_FEEDS, collectNgsiFeed, ngsiHosts, validateNgsiFeedConfig } from "./ngsi";
import { NgsiTransformer } from "./transform";

export interface NgsiCollectorOptions {
  config: SourceConfig;
  hosts: string;
  fetcher: typeof fetch;
}

const transformer = new NgsiTransformer();

export function resolveNgsiFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "ngsi", kinds: NGSI_FEEDS, validate: (value) => validateNgsiFeedConfig(value, hosts) });
}

export function ngsiCollector(options: NgsiCollectorOptions): NormalizedCollector {
  const hosts = ngsiHosts(options.hosts);
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (config) => resolveNgsiFeed(config, hosts),
    source: (state, mode, signal) => {
      // A broker holds what is true now and keeps nothing: there is no past to walk back into.
      if (mode.kind === "history") throw new Error("An NGSI broker exposes no history");
      return collectNgsiFeed(options.config, sourceValidator(state), hosts, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
