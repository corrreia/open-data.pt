import { allowedHosts, resolveFeed, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { ARCGIS_FEEDS, collectArcgisFeed, validateArcgisFeedConfig } from "./arcgis";
import { ArcgisTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, its allowlist, and the fetch it may use. */
export interface ArcgisCollectorOptions {
  config: SourceConfig;
  /** `ARCGIS_ALLOWED_HOSTS`, comma-separated. */
  hosts: string;
  fetcher: typeof fetch;
}

export function resolveArcgisFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, { gatekeeperKind: "arcgis", kinds: ARCGIS_FEEDS, validate: (value) => validateArcgisFeedConfig(value, hosts) });
}

const transformer = new ArcgisTransformer();

/** The whole ArcGIS collection: typed source fetch plus the streaming layer normalizer. */
export function arcgisCollector(options: ArcgisCollectorOptions): NormalizedCollector {
  const hosts = allowedHosts(options.hosts);
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveArcgisFeed(value, hosts),
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("ArcGIS history is not supported");
      return collectArcgisFeed(options.config, sourceValidator(state), hosts, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "streaming", transform: (body, context) => transformer.transform(body, context) },
  };
}
