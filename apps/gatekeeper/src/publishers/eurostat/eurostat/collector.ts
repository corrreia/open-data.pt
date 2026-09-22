import { resolveFeed, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../../index";
import { EUROSTAT_FEEDS, collectEurostatDataset, collectEurostatDatasetHistory, validateEurostatFeedConfig } from "./eurostat";
import { transformEurostatDataset } from "./transform";

/** What a Worker hands this library: the feed's configuration, its API origin, and the fetch it may use. */
export interface EurostatCollectorOptions {
  config: SourceConfig;
  /** `EUROSTAT_API_ORIGIN`. */
  apiOrigin: string;
  fetcher: typeof fetch;
}

export const EUROSTAT_NORMALIZER = { id: "eurostat-jsonstat-dataset", version: "3" } as const;

export function resolveEurostatFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "eurostat", kinds: EUROSTAT_FEEDS, validate: validateEurostatFeedConfig });
}

export function eurostatCollector(options: EurostatCollectorOptions): NormalizedCollector {
  return {
    normalizer: EUROSTAT_NORMALIZER,
    resolve: (value) => resolveEurostatFeed(value),
    source: (state, mode, signal) =>
      mode.kind === "history"
        ? collectEurostatDatasetHistory(options.config, mode.cursor, options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal }))
        : collectEurostatDataset(options.config, sourceValidator(state), options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal })),
    normalize: { kind: "buffered", transform: (bytes, context) => transformEurostatDataset(bytes, context) },
  };
}
