import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { PEERINGDB_FEEDS, validatePeeringdbFeedConfig } from "./peeringdb";
import { PeeringdbTransformer } from "./transform";

/** What a PeeringDB feed's functions are handed when they run: `PEERINGDB_API_ORIGIN`; only https://www.peeringdb.com is accepted. */
export interface PeeringdbContext {
  apiOrigin: string;
}

/** The streaming translator from PeeringDB's exchange pages into directory records; every PeeringDB feed uses it. */
export const PEERINGDB_TRANSFORMER = new PeeringdbTransformer();

/** The normalizer a PeeringDB feed's collection is stamped with: the translator's name and version. */
export const PEERINGDB_NORMALIZER = { id: PEERINGDB_TRANSFORMER.id, version: PEERINGDB_TRANSFORMER.version };

export function resolvePeeringdbFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "peeringdb", kinds: PEERINGDB_FEEDS, validate: validatePeeringdbFeedConfig });
}
