import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { ANEPC_FEEDS, validateAnepcFeedConfig } from "./anepc";
import { AnepcTransformer } from "./transform";

/** What an ANEPC feed's functions are handed when they run: the one origin its service answers on. */
export interface AnepcContext {
  apiOrigin: string;
}

/** The translator from ANEPC's occurrence list into a table of active occurrences. */
export const ANEPC_TRANSFORMER = new AnepcTransformer();

/** The normalizer an ANEPC feed's collection is stamped with: the translator's name and version. */
export const ANEPC_NORMALIZER = { id: ANEPC_TRANSFORMER.id, version: ANEPC_TRANSFORMER.version };

export function resolveAnepcFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "anepc", kinds: ANEPC_FEEDS, validate: validateAnepcFeedConfig });
}
