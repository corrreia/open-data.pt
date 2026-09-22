import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../../index";
import { SNIRH_FEEDS, collectSnirhFeed, collectSnirhHistory, validateSnirhFeedConfig } from "./snirh";
import { SnirhTransformer } from "./transform";

/** What the Worker hands this library: the feed's configuration, the one origin it may read, and its fetch. */
export interface SnirhCollectorOptions {
  config: SourceConfig;
  apiOrigin: string;
  fetcher: typeof fetch;
  now?: () => Date;
}

const transformer = new SnirhTransformer();

export function resolveSnirhFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "snirh", kinds: SNIRH_FEEDS, validate: validateSnirhFeedConfig });
}

export function snirhCollector(options: SnirhCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: resolveSnirhFeed,
    source: (state, mode, signal) => {
      const fetcher: typeof fetch = (input, init) => options.fetcher(input, { ...init, signal });
      return mode.kind === "history"
        ? collectSnirhHistory(options.config, mode.cursor, options.apiOrigin, fetcher)
        : collectSnirhFeed(options.config, sourceValidator(state), options.apiOrigin, fetcher, options.now?.() ?? new Date());
    },
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
