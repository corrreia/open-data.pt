import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { RIPEATLAS_FEEDS, validateRipeatlasFeedConfig } from "./ripeatlas";
import { RipeatlasTransformer } from "./transform";

/** What a RIPE Atlas feed's functions are handed when they run: `RIPEATLAS_API_ORIGIN`; only https://atlas.ripe.net is accepted. */
export interface RipeatlasContext {
  apiOrigin: string;
}

/** The streaming translator from RIPE Atlas's probe and anchor lists into records; every RIPE Atlas feed uses it. */
export const RIPEATLAS_TRANSFORMER = new RipeatlasTransformer();

/** The normalizer a RIPE Atlas feed's collection is stamped with: the translator's name and version. */
export const RIPEATLAS_NORMALIZER = { id: RIPEATLAS_TRANSFORMER.id, version: RIPEATLAS_TRANSFORMER.version };

export function resolveRipeatlasFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "ripeatlas", kinds: RIPEATLAS_FEEDS, validate: validateRipeatlasFeedConfig });
}
