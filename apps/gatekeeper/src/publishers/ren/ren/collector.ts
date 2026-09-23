import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { REN_FEEDS, validateRenFeedConfig } from "./ren";
import { RenTransformer } from "./transform";

/** What a REN feed's functions are handed when they run: the Data Hub's origin, and the service bus its daily and monthly API answers on. */
export interface RenContext {
  apiOrigin: string;
  dataApiOrigin: string;
}

/** The translator from the Data Hub's chart answers into series; every chart feed uses it. */
export const REN_TRANSFORMER = new RenTransformer();

/** The normalizer a chart feed's collection is stamped with: the translator's name and version. */
export const REN_NORMALIZER = { id: REN_TRANSFORMER.id, version: REN_TRANSFORMER.version };

export function resolveRenFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "ren", kinds: REN_FEEDS, validate: validateRenFeedConfig });
}
