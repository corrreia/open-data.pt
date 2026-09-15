import { resolveFeed, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { IPMA_FEEDS, collectIpmaFeed, validateIpmaFeedConfig } from "./ipma";
import { IpmaTransformer } from "./transform";

/** What a Worker hands this library: the feed's configuration, its API origin, and the fetch it may use. */
export interface IpmaCollectorOptions {
  config: SourceConfig;
  /** `IPMA_API_ORIGIN`. */
  apiOrigin: string;
  fetcher: typeof fetch;
}

const transformer = new IpmaTransformer();

export function resolveIpmaFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { gatekeeperKind: "ipma", kinds: IPMA_FEEDS, validate: validateIpmaFeedConfig });
}

export function ipmaCollector(options: IpmaCollectorOptions): NormalizedCollector {
  return {
    normalizer: { id: transformer.id, version: transformer.version },
    resolve: (value) => resolveIpmaFeed(value),
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("IPMA does not publish arbitrary historical slices");
      return collectIpmaFeed(options.config, sourceValidator(state), options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "buffered", transform: (bytes, context) => transformer.transform(bytes, context) },
  };
}
