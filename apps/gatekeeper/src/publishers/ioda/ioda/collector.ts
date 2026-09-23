import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { IODA_FEEDS, validateIodaFeedConfig } from "./ioda";
import { IodaTransformer } from "./transform";

/** What an IODA feed's functions are handed when they run: the hosts they may reach (`IODA_ALLOWED_HOSTS`; only api.ioda.inetintel.cc.gatech.edu is read). */
export interface IodaContext {
  hosts: ReadonlySet<string>;
}

/**
 * The translator from IODA's JSON into outage events, alerts and signal
 * series; every IODA feed uses it. Each window is a few kilobytes of JSON whose
 * series are read by index, so there is nothing to gain from streaming it.
 */
export const IODA_TRANSFORMER = new IodaTransformer();

/** The normalizer an IODA feed's collection is stamped with: the translator's name and version. */
export const IODA_NORMALIZER = { id: IODA_TRANSFORMER.id, version: IODA_TRANSFORMER.version };

export function resolveIodaFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "ioda", kinds: IODA_FEEDS, validate: validateIodaFeedConfig });
}
