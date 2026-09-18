import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { USGS_FEEDS, collectUsgsFeed, validateUsgsFeedConfig } from "./usgs";
import { UsgsTransformer } from "./transform";

export interface UsgsCollectorOptions {
  config: SourceConfig;
  apiOrigin: string;
  fetcher: typeof fetch;
  now?: () => Date;
}

const transformer = new UsgsTransformer();

export function resolveUsgsFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "usgs", kinds: USGS_FEEDS, validate: validateUsgsFeedConfig });
}

export function usgsCollector(options: UsgsCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: resolveUsgsFeed,
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("USGS history is not exposed by this rolling-window feed");
      return collectUsgsFeed(
        options.config,
        sourceValidator(state),
        options.apiOrigin,
        (input, init) => options.fetcher(input, { ...init, signal }),
        options.now?.() ?? new Date(),
      );
    },
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
