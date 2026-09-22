import { resolveFeed, runTransformer, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../../index";
import { ANEPC_FEEDS, collectAnepcFeed, validateAnepcFeedConfig } from "./anepc";
import { AnepcTransformer } from "./transform";

export interface AnepcCollectorOptions {
  config: SourceConfig;
  apiOrigin: string;
  fetcher: typeof fetch;
}

const transformer = new AnepcTransformer();

export function resolveAnepcFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "anepc", kinds: ANEPC_FEEDS, validate: validateAnepcFeedConfig });
}

export function anepcCollector(options: AnepcCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: resolveAnepcFeed,
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("ANEPC exposes only its active snapshot");
      return collectAnepcFeed(options.config, sourceValidator(state), options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "buffered", transform: (bytes, context) => runTransformer(transformer, bytes, context) },
  };
}
