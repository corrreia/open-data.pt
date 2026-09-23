import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { CARRIS_FEEDS, validateCarrisFeedConfig } from "./carris";
import { CarrisTransformer } from "./transform";

/** What a Carris feed's functions are handed when they run: the one origin its API answers on, `CARRIS_API_ORIGIN`. */
export interface CarrisContext {
  apiOrigin: string;
}

/** The translator from Carris Metropolitana's API answers into products; every Carris feed uses it. */
export const CARRIS_TRANSFORMER = new CarrisTransformer();

/** The normalizer a Carris feed's collection is stamped with: the translator's name and version. */
export const CARRIS_NORMALIZER = { id: CARRIS_TRANSFORMER.id, version: CARRIS_TRANSFORMER.version };

export function resolveCarrisFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "carris", kinds: CARRIS_FEEDS, validate: validateCarrisFeedConfig });
}
