import { resolveFeed, type NormalizedCollector, type SourceConfig } from "../../index";
import { collectRipeatlasFeed, RIPEATLAS_FEEDS, validateRipeatlasFeedConfig } from "./ripeatlas";
import { RipeatlasTransformer } from "./transform";

export interface RipeatlasCollectorOptions {
  config: SourceConfig;
  /** RIPEATLAS_API_ORIGIN; only https://atlas.ripe.net is accepted. */
  apiOrigin: string;
  fetcher: typeof fetch;
}

export function ripeatlasCollector(options: RipeatlasCollectorOptions): NormalizedCollector {
  const transformer = new RipeatlasTransformer();
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (config) => resolveFeed(config, { library: "ripeatlas", kinds: RIPEATLAS_FEEDS, validate: validateRipeatlasFeedConfig }),
    source: (_state, mode, signal) =>
      collectRipeatlasFeed(
        options.config,
        options.apiOrigin,
        (input, init) => options.fetcher(input, { ...init, signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal }),
        mode,
      ),
    normalize: { kind: "streaming", transform: (body, context) => transformer.transform(body, context) },
  };
}
