import { resolveFeed, type NormalizedCollector, type ResolvedFeed, type SourceConfig, type SourceStaging } from "#/index";
import { collectParliamentFeed, PARLIAMENT_FEEDS, validateParliamentFeedConfig } from "./parliament";
import { PARLIAMENT_NORMALIZER, transformParliament } from "./transform";

export interface ParliamentCollectorOptions {
  config: SourceConfig;
  fetcher: typeof fetch;
  /** Where downloads wait while their digest is compared; without it every collection parses. */
  staging?: SourceStaging;
}

export function resolveParliamentFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "parliament", kinds: PARLIAMENT_FEEDS, validate: validateParliamentFeedConfig });
}

export function parliamentCollector(options: ParliamentCollectorOptions): NormalizedCollector {
  return {
    normalizer: PARLIAMENT_NORMALIZER,
    resolve: resolveParliamentFeed,
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("Parliament publishes legislature snapshots, not arbitrary historical slices");
      return collectParliamentFeed(options.config, state, (input, init) => options.fetcher(input, { ...init, signal }), options.staging);
    },
    normalize: { kind: "streaming", transform: transformParliament },
  };
}
