import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../../index";
import { SNIT_FEEDS, collectSnitFeed, validateSnitFeedConfig } from "./snit";
import { SnitTransformer } from "./transform";

/** What the Worker hands this library: the feed's configuration, the one origin it may read, and its fetch. */
export interface SnitCollectorOptions {
  config: SourceConfig;
  apiOrigin: string;
  fetcher: typeof fetch;
}

const transformer = new SnitTransformer();

export function resolveSnitFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "snit", kinds: SNIT_FEEDS, validate: validateSnitFeedConfig });
}

export function snitCollector(options: SnitCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: resolveSnitFeed,
    source: (state, mode, signal) => {
      // The register answers with what is in force today and nothing else; the
      // history it does hold — the acts behind each instrument — comes back in
      // every answer, so there is no older slice to walk.
      if (mode.kind === "history") throw new Error("SNIT publishes no older edition of its register");
      return collectSnitFeed(options.config, sourceValidator(state), options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
