import type { LibraryDeployment } from "#/index";
import { resolveParquetFeed, type ParquetContext } from "./collector";
import { OOKLA_BUCKET_ORIGIN, OOKLA_FEEDS } from "./parquet";

/**
 * Ookla's quarterly Parquet files on S3, read by byte range. One quarter kept
 * Node's main thread busy 6 to 12 s (the most for fixed Q3 2021, a single row
 * group of 6.9 million tiles, 46,525 of them Portugal's): Snappy, dictionary
 * decoding, and encoding some 40,000 rows. A minute leaves room on a slower
 * isolate.
 */
export const PARQUET_DEPLOYMENT: LibraryDeployment<{ readonly OOKLA_BUCKET_ORIGIN: string }, ParquetContext> = {
  source: "parquet",
  name: "Ookla's Parquet tiles on S3",
  vars: { OOKLA_BUCKET_ORIGIN },
  cpuMs: 60_000,
  library: (env) => ({
    kinds: Object.values(OOKLA_FEEDS),
    resolve: resolveParquetFeed,
    context: { bucketOrigin: env.OOKLA_BUCKET_ORIGIN },
  }),
};
