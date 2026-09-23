import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { RIPESTAT_FEEDS, validateRipestatFeedConfig } from "./ripestat";
import { RipestatTransformer } from "./transform";

/** What a RIPEstat feed's functions are handed when they run: `RIPESTAT_API_ORIGIN`; only https://stat.ripe.net is accepted. */
export interface RipestatContext {
  apiOrigin: string;
}

/** The streaming translator from RIPEstat's data calls into products; every RIPEstat feed uses it. */
export const RIPESTAT_TRANSFORMER = new RipestatTransformer();

/** The normalizer a RIPEstat feed's collection is stamped with: the translator's name and version. */
export const RIPESTAT_NORMALIZER = { id: RIPESTAT_TRANSFORMER.id, version: RIPESTAT_TRANSFORMER.version };

export function resolveRipestatFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "ripestat", kinds: RIPESTAT_FEEDS, validate: validateRipestatFeedConfig });
}
