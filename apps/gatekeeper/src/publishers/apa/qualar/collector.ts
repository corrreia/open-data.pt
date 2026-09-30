import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { QUALAR_FEEDS, validateQualarFeedConfig } from "./qualar";
import { QualarTransformer } from "./transform";

/** What a QualAr feed's functions are handed when they run: the one origin they may read. */
export interface QualarContext {
  apiOrigin: string;
}

/** The translator from QualAr's measurements into series; every QualAr feed uses it. */
export const QUALAR_TRANSFORMER = new QualarTransformer();

/** The normalizer a QualAr feed's collection is stamped with: the translator's name and version. */
export const QUALAR_NORMALIZER = { id: QUALAR_TRANSFORMER.id, version: QUALAR_TRANSFORMER.version };

export function resolveQualarFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "qualar", kinds: QUALAR_FEEDS, validate: validateQualarFeedConfig });
}
