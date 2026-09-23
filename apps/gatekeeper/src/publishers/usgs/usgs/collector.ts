import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { USGS_FEEDS, validateUsgsFeedConfig } from "./usgs";
import { UsgsTransformer } from "./transform";

/** What a USGS feed's functions are handed when they run: the one origin they may read. */
export interface UsgsContext {
  apiOrigin: string;
}

/** The translator from the USGS catalog's GeoJSON into earthquake records; every USGS feed uses it. */
export const USGS_TRANSFORMER = new UsgsTransformer();

/** The normalizer a USGS feed's collection is stamped with: the translator's name and version. */
export const USGS_NORMALIZER = { id: USGS_TRANSFORMER.id, version: USGS_TRANSFORMER.version };

export function resolveUsgsFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "usgs", kinds: USGS_FEEDS, validate: validateUsgsFeedConfig });
}
