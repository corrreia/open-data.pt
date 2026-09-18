import { resolveFeed, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { INE_FEEDS, collectIneIndicator, collectIneIndicatorHistory, validateIneFeedConfig } from "./ine";
import { transformIneIndicator } from "./transform";

/** What a Worker hands this library: the feed's configuration, its API origin, and the fetch it may use. */
export interface IneCollectorOptions {
  config: SourceConfig;
  /** `INE_API_ORIGIN`. */
  apiOrigin: string;
  fetcher: typeof fetch;
}

export const INE_NORMALIZER = { id: "ine-indicator", version: "3" } as const;

export function resolveIneFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "ine", kinds: INE_FEEDS, validate: validateIneFeedConfig });
}

export function ineCollector(options: IneCollectorOptions): NormalizedCollector {
  return {
    normalizer: INE_NORMALIZER,
    resolve: (value) => resolveIneFeed(value),
    source: (state, mode, signal) =>
      mode.kind === "history"
        ? collectIneIndicatorHistory(options.config, mode.cursor, options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal }))
        : collectIneIndicator(options.config, sourceValidator(state), options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal })),
    normalize: { kind: "buffered", transform: (bytes, context) => transformIneIndicator(bytes, context) },
  };
}
