import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-caop-nuts2-feed",
  title: "Mainland Portugal NUTS II regions, placed (CAOP 2025)",
  description:
    "The seven NUTS II regions the charter covers, with the code, the area in hectares, the perimeter, how many municipalities and parishes each holds, and where each one lies and how far it reaches. These are the regions most Portuguese and European statistics are published by, so they are what a figure keyed to a region can be drawn against. The outlines are left at the source, because the mainland regions pass the megabyte a record may hold. The Azores and Madeira appear here as regions of the statistical hierarchy, though their areas are not part of this collection.",
  config: {
    host: DGT_HOST,
    collection: "nuts2",
    geometry: "point",
    pageSize: "10",
    maxPages: "4",
  },
  policy: { name: "CAOP weekly placed table", version: 3, collection: measuredCollection({ source: 50, output: 1, largestRow: 1 }, WEEK) },
  staleAfterSeconds: 1_209_600,
  /** Every week: the CAOP's nuts2 collection walked page by page from DGT's OGC API, each area placed by where it lies and how far it reaches, its outline left behind. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the collection's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
