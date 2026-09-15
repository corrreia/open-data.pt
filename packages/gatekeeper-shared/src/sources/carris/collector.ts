import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { CARRIS_FEEDS, collectCarrisFeed, validateCarrisFeedConfig } from "./carris";
import { CarrisTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, its API origin, and the fetch it may use. */
export interface CarrisCollectorOptions {
  config: SourceConfig;
  /** `CARRIS_API_ORIGIN`. */
  apiOrigin: string;
  fetcher: typeof fetch;
}

const transformer = new CarrisTransformer();

export function resolveCarrisFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { gatekeeperKind: "carris", kinds: CARRIS_FEEDS, validate: validateCarrisFeedConfig });
}

export function carrisCollector(options: CarrisCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveCarrisFeed(value),
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("Carris history is not supported");
      return collectCarrisFeed(options.config, sourceValidator(state), options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
