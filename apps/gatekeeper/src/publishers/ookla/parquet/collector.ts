import { resolveFeed, type ResolvedFeed, type SourceConfig } from "#/index";
import { OOKLA_FEEDS, validateParquetFeedConfig } from "./parquet";
import { TilesTransformer } from "./transform";

/** What an Ookla feed's functions are handed when they run: the bucket's origin. */
export interface ParquetContext {
  bucketOrigin: string;
}

/** The translator from Portugal's tiles of one quarter into a table; both Ookla feeds use it. */
export const TILES_TRANSFORMER = new TilesTransformer();

/** The normalizer an Ookla feed's collection is stamped with: the translator's name and version. */
export const TILES_NORMALIZER = { id: TILES_TRANSFORMER.id, version: TILES_TRANSFORMER.version };

export function resolveParquetFeed(config: SourceConfig): Promise<ResolvedFeed> {
  return resolveFeed(config, { library: "parquet", kinds: OOKLA_FEEDS, validate: validateParquetFeedConfig });
}
