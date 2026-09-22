import { resolveFeed, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { FIRMS_FEEDS, collectFirmsFeed, validateFirmsFeedConfig } from "./firms";
import { FirmsTransformer } from "./transform";

export interface FirmsCollectorOptions {
  config: SourceConfig;
  apiOrigin: string;
  mapKey: string;
  fetcher: typeof fetch;
}

const transformer = new FirmsTransformer();

export function resolveFirmsFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "firms", kinds: FIRMS_FEEDS, validate: validateFirmsFeedConfig });
}

export function firmsCollector(options: FirmsCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: resolveFirmsFeed,
    source: (_state, mode, signal) => {
      if (mode.kind === "history") throw new Error("FIRMS history is not exposed by this rolling-window feed");
      return collectFirmsFeed(options.config, options.apiOrigin, options.mapKey, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "streaming", transform: (body, context) => transformer.transform(body, context) },
  };
}
