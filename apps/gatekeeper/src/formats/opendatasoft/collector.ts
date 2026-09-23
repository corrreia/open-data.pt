import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { OPENDATASOFT_FEEDS, validateOpendatasoftFeedConfig } from "./opendatasoft";
import { OpendatasoftTransformer } from "./transform";

/** What an Opendatasoft feed's functions are handed when they run: the hosts its publishers' feeds name, the only ones it may fetch. */
export interface OpendatasoftContext {
  hosts: ReadonlySet<string>;
}

/** The translator from an Explore v2.1 export into tables and series; every Opendatasoft feed uses it. */
export const OPENDATASOFT_TRANSFORMER = new OpendatasoftTransformer();

/** The normalizer an Opendatasoft feed's collection is stamped with: the translator's name and version. */
export const OPENDATASOFT_NORMALIZER = { id: OPENDATASOFT_TRANSFORMER.id, version: OPENDATASOFT_TRANSFORMER.version };

/** Canonical feed resolution, shared by the Worker entrypoint and the tests. */
export async function resolveOpendatasoftFeed(config: SourceConfig, hosts: ReadonlySet<string>): Promise<ResolvedFeed> {
  const resolved = await resolveFeed(config, { library: "opendatasoft", kinds: OPENDATASOFT_FEEDS, validate: (value) => validateOpendatasoftFeedConfig(value, hosts) });
  // The history walker filters one source field; compound year/month or year/quarter clocks cannot use it.
  if (config.monthField || config.quarterField) delete resolved.history;
  return resolved;
}
