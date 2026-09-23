import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { NGSI_FEEDS, validateNgsiFeedConfig } from "./ngsi";
import { NgsiTransformer } from "./transform";

/** What an NGSI feed's functions are handed when they run: the brokers its publishers' feeds name, the only ones it may read. */
export interface NgsiContext {
  hosts: ReadonlySet<string>;
}

/** The translator from a broker's entities into records and series; every NGSI feed uses it. */
export const NGSI_TRANSFORMER = new NgsiTransformer();

/** The normalizer an NGSI feed's collection is stamped with: the translator's name and version. */
export const NGSI_NORMALIZER = { id: NGSI_TRANSFORMER.id, version: NGSI_TRANSFORMER.version };

export function resolveNgsiFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "ngsi", kinds: NGSI_FEEDS, validate: (value) => validateNgsiFeedConfig(value, hosts) });
}
