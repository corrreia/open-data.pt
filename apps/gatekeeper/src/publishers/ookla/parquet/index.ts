/** Ookla's Speedtest performance tiles: quarterly Parquet files on S3, read by byte range for Portugal's tiles alone. */
export { TILES_NORMALIZER, TILES_TRANSFORMER, resolveParquetFeed, type ParquetContext } from "./collector";
export {
  OOKLA_BUCKET_ORIGIN,
  OOKLA_DOCUMENTATION,
  OOKLA_FEEDS,
  OOKLA_MAX_SOURCE_BYTES,
  OOKLA_MAX_TILES,
  TILE_COLUMNS,
  collectLatestTiles,
  collectTilesBefore,
  listQuarters,
  parseListing,
  portugalTiles,
  quarterOf,
  rangeReader,
  validateParquetFeedConfig,
  type OoklaLayer,
  type QuarterFile,
  type TilesMetadata,
} from "./parquet";
export { FOOTER_READ_BYTES, footerLength, hybrid, parseLayout, readLayout, rowsInRanges, type ParquetLayout, type QuadkeyRow, type RangeReader, type ReadBudget } from "./reader";
export { PORTUGAL, beyond, covers, overlaps, quadkeyRanges, tileCentre, type QuadkeyRange } from "./quadkeys";
export { snappyUncompress } from "./snappy";
export { TilesTransformer } from "./transform";
export { PARQUET_DEPLOYMENT } from "./deployment";
