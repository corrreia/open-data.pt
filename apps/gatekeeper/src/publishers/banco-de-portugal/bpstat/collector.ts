import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { BPSTAT_FEEDS, validateBpstatFeedConfig } from "./bpstat";

/** What a BPstat feed's functions are handed when they run: the one origin its API answers on. */
export interface BpstatContext {
  apiOrigin: string;
}

/** The normalizer a BPstat feed's collection is stamped with: the JSON-stat dataset translator's name and version. */
export const BPSTAT_NORMALIZER = { id: "bpstat-jsonstat-dataset", version: "4" } as const;

export function resolveBpstatFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "bpstat", kinds: BPSTAT_FEEDS, validate: validateBpstatFeedConfig });
}
