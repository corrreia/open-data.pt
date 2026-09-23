import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { INFOAGUA_FEEDS, validateInfoaguaFeedConfig } from "./infoagua";
import { InfoaguaTransformer } from "./transform";

/** What an InfoÁgua feed's functions are handed when they run: the one origin they may read. */
export interface InfoaguaContext {
  apiOrigin: string;
}

/** The translator from InfoÁgua's pages into alerts and drought states; every InfoÁgua feed uses it. */
export const INFOAGUA_TRANSFORMER = new InfoaguaTransformer();

/** The normalizer an InfoÁgua feed's collection is stamped with: the translator's name and version. */
export const INFOAGUA_NORMALIZER = { id: INFOAGUA_TRANSFORMER.id, version: INFOAGUA_TRANSFORMER.version };

export function resolveInfoaguaFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "infoagua", kinds: INFOAGUA_FEEDS, validate: validateInfoaguaFeedConfig });
}
