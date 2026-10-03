import { defineFeed } from "#/catalog/define";
import { OOKLA_TERMS, OOKLA_TILES_POLICY } from "#/publishers/ookla/parquet/feeds";
import { PARQUET_DEPLOYMENT, TILES_NORMALIZER, TILES_TRANSFORMER, collectLatestTiles, collectTilesBefore } from "#/publishers/ookla/parquet/index";

export const FEED = defineFeed(PARQUET_DEPLOYMENT, {
  slug: "ookla-mobile-network-performance-feed",
  title: "Mobile network speeds across Portugal",
  description:
    "Average download and upload speed and latency of the Speedtest tests people ran over a cellular connection (4G, 5G and older), on phones that reported a GPS-quality location, in each tile of about half a kilometre across mainland Portugal, Madeira and the Azores: one row per tile per quarter, with how many tests and devices each average comes from. A tile appears only in the quarters someone tested in it, and an average of a few tests says little about the network there; operators are not told apart. Latency while downloading and uploading begins in the last quarter of 2022 and not every test measures it. Tiles within about a kilometre of the Spanish border may fall on either side of it. The current table is the latest quarter Ookla has published; history keeps every quarter since 2019.",
  ...OOKLA_TERMS,
  config: { feed: "tiles", type: "mobile" },
  policy: OOKLA_TILES_POLICY,
  staleAfterSeconds: 1_814_400,
  /** Weekly: the bucket's list of mobile quarters, and the newest one's tiles over Portugal when it is new. */
  fetch: ({ config, state, library, fetch }) => collectLatestTiles(config, state, library.bucketOrigin, fetch),
  /** Once, walking back: one older quarter a slice, to the first quarter of 2019. */
  backfill: ({ config, library, fetch }, cursor) => collectTilesBefore(config, cursor, library.bucketOrigin, fetch),
  /** The quarter's tiles over Portugal, one row each. */
  transform: { normalizer: TILES_NORMALIZER, streaming: (body, context, metadata) => TILES_TRANSFORMER.transform(body, context, metadata) },
});
