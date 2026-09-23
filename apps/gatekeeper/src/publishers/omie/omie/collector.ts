import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { OMIE_FEEDS, validateOmieFeedConfig } from "./omie";
import { OmieTransformer } from "./transform";

/** What an OMIE feed's functions are handed when they run: the one origin its files are served from. */
export interface OmieContext {
  apiOrigin: string;
}

/** The translator from OMIE's price files into hourly series; every OMIE feed uses it. */
export const OMIE_TRANSFORMER = new OmieTransformer();

/** The normalizer an OMIE feed's collection is stamped with: the translator's name and version. */
export const OMIE_NORMALIZER = { id: OMIE_TRANSFORMER.id, version: OMIE_TRANSFORMER.version };

export function resolveOmieFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "omie", kinds: OMIE_FEEDS, validate: validateOmieFeedConfig });
}
