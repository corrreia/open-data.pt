import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { INE_FEEDS, validateIneFeedConfig } from "./ine";

/** What an INE feed's functions are handed when they run: the one origin its API answers on. */
export interface IneContext {
  apiOrigin: string;
}

/** The normalizer an INE feed's collection is stamped with. */
export const INE_NORMALIZER = { id: "ine-indicator", version: "3" } as const;

export function resolveIneFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "ine", kinds: INE_FEEDS, validate: validateIneFeedConfig });
}
