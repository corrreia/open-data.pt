import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { DATASTORE_FEEDS, validateDataStoreFeedConfig, type DataStoreCredentials } from "./datastore";
import { ActiveFiresTransformer } from "./transform";

/** What a Data Store feed's functions are handed when they run: the API's origin, and the account it reads files with. */
export interface DataStoreContext {
  apiOrigin: string;
  credentials: DataStoreCredentials;
}

/** The translator from Meteosat's active fire scans into fires and counts over Portugal. */
export const ACTIVE_FIRES_TRANSFORMER = new ActiveFiresTransformer();

/** The normalizer the active fires' collections are stamped with. */
export const ACTIVE_FIRES_NORMALIZER = { id: ACTIVE_FIRES_TRANSFORMER.id, version: ACTIVE_FIRES_TRANSFORMER.version };

export function resolveDataStoreFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "datastore", kinds: DATASTORE_FEEDS, validate: validateDataStoreFeedConfig });
}
