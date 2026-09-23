import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { SNIRH_FEEDS, validateSnirhFeedConfig } from "./snirh";
import { SnirhTransformer } from "./transform";

/** What a SNIRH feed's functions are handed when they run: the one origin they may read. */
export interface SnirhContext {
  apiOrigin: string;
}

/** The translator from SNIRH's exports and bulletins into series; every SNIRH feed uses it. */
export const SNIRH_TRANSFORMER = new SnirhTransformer();

/** The normalizer a SNIRH feed's collection is stamped with: the translator's name and version. */
export const SNIRH_NORMALIZER = { id: SNIRH_TRANSFORMER.id, version: SNIRH_TRANSFORMER.version };

export function resolveSnirhFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "snirh", kinds: SNIRH_FEEDS, validate: validateSnirhFeedConfig });
}
