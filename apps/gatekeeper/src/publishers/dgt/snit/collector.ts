import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { SNIT_FEEDS, validateSnitFeedConfig } from "./snit";
import { SnitTransformer } from "./transform";

/**
 * What a SNIT feed's functions are handed when they run: the one origin they
 * may read. The register answers with what is in force today and nothing else;
 * the history it does hold — the acts behind each instrument — comes back in
 * every answer, so there is no older slice to walk and no feed has a backfill.
 */
export interface SnitContext {
  apiOrigin: string;
}

/** The translator from the register's answer into instruments and acts; every SNIT feed uses it. */
export const SNIT_TRANSFORMER = new SnitTransformer();

/** The normalizer a SNIT feed's collection is stamped with: the translator's name and version. */
export const SNIT_NORMALIZER = { id: SNIT_TRANSFORMER.id, version: SNIT_TRANSFORMER.version };

export function resolveSnitFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "snit", kinds: SNIT_FEEDS, validate: validateSnitFeedConfig });
}
