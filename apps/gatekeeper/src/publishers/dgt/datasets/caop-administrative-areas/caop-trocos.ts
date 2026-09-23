import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-caop-trocos-feed",
  title: "Mainland Portugal administrative boundary segments (CAOP 2025)",
  description:
    "The 9,899 segments the administrative boundaries of mainland Portugal are drawn from, with the line each one follows: which area lies either side of it, whether it runs on land or along the coast, the order of boundary it carries, whether it is settled or still undefined, and how long it is. Where a parish outline says what an area covers, these say what each stretch of its edge is and who agreed to it.",
  config: {
    host: DGT_HOST,
    collection: "trocos",
    geometry: "include",
    pageSize: "500",
    maxPages: "22",
  },
  policy: { name: "CAOP weekly boundaries", version: 3, collection: measuredCollection({ source: 219, output: 67, largestRow: 397 }, WEEK) },
  staleAfterSeconds: 1_209_600,
  /** Every week: the CAOP's trocos collection walked page by page from DGT's OGC API, every feature with its outline. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the collection's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
