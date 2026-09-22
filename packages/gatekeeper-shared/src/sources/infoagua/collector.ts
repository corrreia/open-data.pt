import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { INFOAGUA_FEEDS, collectInfoaguaFeed, validateInfoaguaFeedConfig } from "./infoagua";
import { InfoaguaTransformer } from "./transform";

/** What the Worker hands this library: the feed's configuration, the one origin it may read, and its fetch. */
export interface InfoaguaCollectorOptions {
  config: SourceConfig;
  apiOrigin: string;
  fetcher: typeof fetch;
}

const transformer = new InfoaguaTransformer();

export function resolveInfoaguaFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "infoagua", kinds: INFOAGUA_FEEDS, validate: validateInfoaguaFeedConfig });
}

export function infoaguaCollector(options: InfoaguaCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: resolveInfoaguaFeed,
    source: (state, mode, signal) => {
      // The app shows the present only: the latest alert of each station and the latest month of the drought index.
      if (mode.kind === "history") throw new Error("InfoÁgua keeps no archive of its alerts or its drought index");
      return collectInfoaguaFeed(options.config, sourceValidator(state), options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
