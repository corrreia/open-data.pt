import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { EUROSTAT_FEEDS, validateEurostatFeedConfig } from "./eurostat";

/** What a Eurostat feed's functions are handed when they run: the one origin its API answers on. */
export interface EurostatContext {
  apiOrigin: string;
}

/** The normalizer a Eurostat feed's collection is stamped with. */
export const EUROSTAT_NORMALIZER = { id: "eurostat-jsonstat-dataset", version: "3" } as const;

export function resolveEurostatFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "eurostat", kinds: EUROSTAT_FEEDS, validate: validateEurostatFeedConfig });
}
