import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { DGEG_FEEDS, validateDgegFeedConfig } from "./dgeg";
import { DgegTransformer } from "./transform";

/** What a DGEG feed's functions are handed when they run: the one origin its API answers on. */
export interface DgegContext {
  apiOrigin: string;
}

/** The translator from DGEG's fuel lists and station prices into tables and series; every DGEG feed uses it. */
export const DGEG_TRANSFORMER = new DgegTransformer();

/** The normalizer a DGEG feed's collection is stamped with: the translator's name and version. */
export const DGEG_NORMALIZER = { id: DGEG_TRANSFORMER.id, version: DGEG_TRANSFORMER.version };

/** DGEG names its fuels by numeric id, so resolution asks the source for the current list. */
export function resolveDgegFeed(config: SourceConfig, apiOrigin: string, fetcher: typeof fetch): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "dgeg", kinds: DGEG_FEEDS, validate: (value) => validateDgegFeedConfig(value, apiOrigin, fetcher) });
}
