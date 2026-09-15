import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { METRO_FEEDS, collectMetroFeed, validateMetroFeedConfig, type MetroCredentials } from "./metrolisboa";
import { MetroLisboaTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, its gateway, its credentials, and the fetch it may use. */
export interface MetrolisboaCollectorOptions {
  config: SourceConfig;
  /** `METROLISBOA_API_ORIGIN`. */
  apiOrigin: string;
  /** The Worker's `ML_CONSUMER_KEY` and `ML_CONSUMER_SECRET` secrets. */
  credentials: MetroCredentials;
  fetcher: typeof fetch;
}

const transformer = new MetroLisboaTransformer();

export function resolveMetrolisboaFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { gatekeeperKind: "metrolisboa", kinds: METRO_FEEDS, validate: validateMetroFeedConfig });
}

export function metrolisboaCollector(options: MetrolisboaCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveMetrolisboaFeed(value),
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("Metro Lisboa history is not supported");
      return collectMetroFeed(options.config, sourceValidator(state), options.apiOrigin, options.credentials, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
