import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { PICASSO_FEEDS, validatePicassoFeedConfig } from "./picasso";
import { PicassoTransformer } from "./transform";

/** What a Picasso feed's functions are handed when they run: the one origin they may read. */
export interface PicassoContext {
  apiOrigin: string;
}

/** The translator from Picasso's chart answers into a traffic series; every Picasso feed uses it. */
export const PICASSO_TRANSFORMER = new PicassoTransformer();

/** The normalizer a Picasso feed's collection is stamped with: the translator's name and version. */
export const PICASSO_NORMALIZER = { id: PICASSO_TRANSFORMER.id, version: PICASSO_TRANSFORMER.version };

export function resolvePicassoFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "picasso", kinds: PICASSO_FEEDS, validate: validatePicassoFeedConfig });
}
