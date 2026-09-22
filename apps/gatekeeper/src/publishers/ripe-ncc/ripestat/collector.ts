import { resolveFeed, type NormalizedCollector, type SourceConfig } from "#/index";
import { collectRipestatFeed, RIPESTAT_FEEDS, validateRipestatFeedConfig } from "./ripestat";
import { RipestatTransformer } from "./transform";

export interface RipestatCollectorOptions {
  config: SourceConfig;
  /** RIPESTAT_API_ORIGIN; only https://stat.ripe.net is accepted. */
  apiOrigin: string;
  fetcher: typeof fetch;
  /** Request-window clock only, never an observation timestamp. */
  now?: () => Date;
}

export function ripestatCollector(options: RipestatCollectorOptions): NormalizedCollector {
  const transformer = new RipestatTransformer();
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (config) => resolveFeed(config, { library: "ripestat", kinds: RIPESTAT_FEEDS, validate: validateRipestatFeedConfig }),
    source: (state, mode, signal) =>
      collectRipestatFeed(
        options.config,
        state,
        options.apiOrigin,
        (input, init) => options.fetcher(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }),
        mode,
        options.now?.() ?? new Date(),
      ),
    normalize: { kind: "streaming", transform: (body, context) => transformer.transform(body, context) },
  };
}
