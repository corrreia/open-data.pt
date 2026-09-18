import { resolveFeed, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { DGEG_FEEDS, collectDgegFeed, validateDgegFeedConfig } from "./dgeg";
import { DgegTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, its API origin, and the fetch it may use. */
export interface DgegCollectorOptions {
  config: SourceConfig;
  /** `DGEG_API_ORIGIN`. */
  apiOrigin: string;
  fetcher: typeof fetch;
}

const transformer = new DgegTransformer();

/** DGEG names its fuels by numeric id, so resolution asks the source for the current list. */
export function resolveDgegFeed(config: SourceConfig, apiOrigin: string, fetcher: typeof fetch): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "dgeg", kinds: DGEG_FEEDS, validate: (value) => validateDgegFeedConfig(value, apiOrigin, fetcher) });
}

export function dgegCollector(options: DgegCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveDgegFeed(value, options.apiOrigin, options.fetcher),
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("DGEG history is not supported");
      return collectDgegFeed(options.config, sourceValidator(state), options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "buffered", transform: (bytes, context) => transformer.transform(bytes, context) },
  };
}
