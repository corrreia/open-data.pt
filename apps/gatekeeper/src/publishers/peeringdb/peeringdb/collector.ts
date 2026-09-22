import { resolveFeed, type NormalizedCollector, type SourceConfig } from "#/index";
import { collectPeeringdbFeed, PEERINGDB_FEEDS, validatePeeringdbFeedConfig } from "./peeringdb";
import { PeeringdbTransformer } from "./transform";

export interface PeeringdbCollectorOptions {
  config: SourceConfig;
  /** PEERINGDB_API_ORIGIN; only https://www.peeringdb.com is accepted. */
  apiOrigin: string;
  fetcher: typeof fetch;
}

export function peeringdbCollector(options: PeeringdbCollectorOptions): NormalizedCollector {
  const transformer = new PeeringdbTransformer();
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (config) => resolveFeed(config, { library: "peeringdb", kinds: PEERINGDB_FEEDS, validate: validatePeeringdbFeedConfig }),
    source: (_state, mode, signal) => {
      if (mode.kind === "history") throw new Error("PeeringDB directory history is not supported");
      return collectPeeringdbFeed(options.config, options.apiOrigin, (input, init) =>
        options.fetcher(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }),
      );
    },
    normalize: { kind: "streaming", transform: (body, context) => transformer.transform(body, context) },
  };
}
