import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "#/index";
import { REN_FEEDS, collectRenFeed, collectRenHistory, validateRenFeedConfig } from "./ren";
import { RenTransformer } from "./transform";
import { isRenPeriodicService, REN_PERIODIC_ORIGIN, renPeriodicCollector } from "./periodic";

/** What a Worker hands this library: the feed's configuration, its API origin, and the fetch it may use. */
export interface RenCollectorOptions {
  config: SourceConfig;
  /** `REN_API_ORIGIN`. */
  apiOrigin: string;
  /** `REN_DATA_API_ORIGIN`, for the documented daily/monthly API. */
  dataApiOrigin?: string;
  fetcher: typeof fetch;
}

const transformer = new RenTransformer();

export function resolveRenFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "ren", kinds: REN_FEEDS, validate: validateRenFeedConfig });
}

export function renCollector(options: RenCollectorOptions): NormalizedCollector {
  if (isRenPeriodicService(options.config.service ?? options.config.feed)) {
    return renPeriodicCollector({ config: options.config, apiOrigin: options.dataApiOrigin ?? REN_PERIODIC_ORIGIN, fetcher: options.fetcher });
  }
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveRenFeed(value),
    source: (state, mode, signal) =>
      mode.kind === "history"
        ? collectRenHistory(options.config, mode.cursor, options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal }))
        : collectRenFeed(options.config, sourceValidator(state), options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal })),
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
