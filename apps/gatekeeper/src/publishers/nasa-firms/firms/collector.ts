import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { FIRMS_FEEDS, validateFirmsFeedConfig } from "./firms";
import { FirmsTransformer } from "./transform";

/** What a FIRMS feed's functions are handed when they run: the API's origin, and the map key every request carries. */
export interface FirmsContext {
  apiOrigin: string;
  /** `NASA_FIRMS_MAP_KEY`, a secret. */
  mapKey: string;
}

/** The streaming translator from FIRMS's area CSV into thermal-anomaly records; every FIRMS feed uses it. */
export const FIRMS_TRANSFORMER = new FirmsTransformer();

/** The normalizer a FIRMS feed's collection is stamped with: the translator's name and version. */
export const FIRMS_NORMALIZER = { id: FIRMS_TRANSFORMER.id, version: FIRMS_TRANSFORMER.version };

export function resolveFirmsFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "firms", kinds: FIRMS_FEEDS, validate: validateFirmsFeedConfig });
}
