import { resolveFeed, sourceValidator, type NormalizedCollector, type ResolvedFeed, type SourceConfig } from "../../index";
import { BPSTAT_FEEDS, collectBpstatDataset, validateBpstatFeedConfig } from "./bpstat";
import { transformBpstatDataset } from "./transform";

/** What a Worker hands this library: the feed's configuration, its API origin, and the fetch it may use. */
export interface BpstatCollectorOptions {
  config: SourceConfig;
  /** `BPSTAT_API_ORIGIN`. */
  apiOrigin: string;
  fetcher: typeof fetch;
}

export const BPSTAT_NORMALIZER = { id: "bpstat-jsonstat-dataset", version: "3" } as const;

export function resolveBpstatFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { gatekeeperKind: "bpstat", kinds: BPSTAT_FEEDS, validate: validateBpstatFeedConfig });
}

export function bpstatCollector(options: BpstatCollectorOptions): NormalizedCollector {
  return {
    normalizer: BPSTAT_NORMALIZER,
    resolve: (value) => resolveBpstatFeed(value),
    source: (state, mode, signal) => {
      if (mode.kind === "history") throw new Error("BPstat history is not supported");
      return collectBpstatDataset(options.config, sourceValidator(state), options.apiOrigin, (input, init) => options.fetcher(input, { ...init, signal }));
    },
    normalize: { kind: "buffered", transform: (bytes, context) => transformBpstatDataset(bytes, context) },
  };
}
