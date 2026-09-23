import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { NASA_POWER_FEEDS, validateNasaPowerFeedConfig } from "./nasapower";
import { NasaPowerTransformer } from "./transform";

/** What a NASA POWER feed's functions are handed when they run: the one origin they may read. */
export interface NasaPowerContext {
  apiOrigin: string;
}

/** The translator from POWER's regional JSON into daily series; every NASA POWER feed uses it. */
export const NASA_POWER_TRANSFORMER = new NasaPowerTransformer();

/** The normalizer a NASA POWER feed's collection is stamped with: the translator's name and version. */
export const NASA_POWER_NORMALIZER = { id: NASA_POWER_TRANSFORMER.id, version: NASA_POWER_TRANSFORMER.version };

export function resolveNasaPowerFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "nasapower", kinds: NASA_POWER_FEEDS, validate: validateNasaPowerFeedConfig });
}
