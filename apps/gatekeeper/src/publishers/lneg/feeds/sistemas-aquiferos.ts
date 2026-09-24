import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { MONTH, measuredCollection } from "#/formats/ogc/feeds";
import { LNEG_HOST } from "#/publishers/lneg/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "lneg-sistemas-aquiferos-feed",
  title: "Aquifer systems",
  description:
    "The 63 aquifer systems of Portugal as LNEG delimits them, with their outlines, the national code each carries, the geological age of the rock that holds the water and the hydrogeological unit each belongs to.",
  licence: "cc-by-4.0",
  attribution: "Laboratório Nacional de Energia e Geologia",
  topics: ["environment"],
  config: {
    host: LNEG_HOST,
    collection: "recursoshidro-sistemas-aqu-feros",
    geometry: "include",
    pageSize: "500",
    maxPages: "4",
  },
  policy: {
    name: "LNEG monthly reference layer",
    version: 2,
    collection: measuredCollection({ source: 2, output: 2, largestRow: 219 }, MONTH),
  },
  staleAfterSeconds: 2 * MONTH,
  /** Once a month: the recursoshidro-sistemas-aqu-feros collection walked page by page from LNEG's OGC API, every feature with its geometry. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the collection's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
