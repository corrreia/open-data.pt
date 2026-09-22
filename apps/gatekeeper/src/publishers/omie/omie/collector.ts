import { resolveFeed, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "#/index";
import { OMIE_FEEDS, collectOmieFeed, collectOmieHistory, validateOmieFeedConfig } from "./omie";
import { OmieTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, its API origin, and the fetch it may use. */
export interface OmieCollectorOptions {
  config: SourceConfig;
  /** `OMIE_API_ORIGIN`. */
  apiOrigin: string;
  fetcher: typeof fetch;
}

const transformer = new OmieTransformer();

export function resolveOmieFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "omie", kinds: OMIE_FEEDS, validate: validateOmieFeedConfig });
}

export function omieCollector(options: OmieCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveOmieFeed(value),
    source: (state, mode, signal) =>
      mode.kind === "history"
        ? collectOmieHistory(options.config, mode.cursor, options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal }))
        : collectOmieFeed(options.config, sourceValidator(state), options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal })),
    normalize: { kind: "buffered", transform: (bytes, context) => transformer.transform(bytes, context) },
  };
}
