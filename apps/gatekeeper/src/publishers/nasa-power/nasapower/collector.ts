import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../../index";
import { NASA_POWER_FEEDS, collectNasaPowerFeed, validateNasaPowerFeedConfig } from "./nasapower";
import { NasaPowerTransformer } from "./transform";

export interface NasaPowerCollectorOptions {
  config: SourceConfig;
  apiOrigin: string;
  fetcher: typeof fetch;
  now?: () => Date;
}

const transformer = new NasaPowerTransformer();

export function resolveNasaPowerFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "nasapower", kinds: NASA_POWER_FEEDS, validate: validateNasaPowerFeedConfig });
}

export function nasaPowerCollector(options: NasaPowerCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: resolveNasaPowerFeed,
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("NASA POWER history is not exposed by this rolling-window feed");
      return collectNasaPowerFeed(
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
