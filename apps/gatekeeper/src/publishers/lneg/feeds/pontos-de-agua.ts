import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { MONTH, measuredCollection } from "#/formats/ogc/feeds";
import { LNEG_HOST } from "#/publishers/lneg/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "lneg-pontos-de-agua-feed",
  title: "Groundwater points",
  description:
    "The 5,399 water points in LNEG's groundwater inventory: where each is, the district it lies in, its elevation, what kind of point it is, what it is used for and what it was surveyed for.",
  licence: "cc-by-4.0",
  attribution: "Laboratório Nacional de Energia e Geologia",
  topics: ["environment"],
  config: {
    host: LNEG_HOST,
    collection: "recursoshidro-pontos-de-gua",
    geometry: "include",
    pageSize: "500",
    maxPages: "13",
  },
  policy: {
    name: "LNEG monthly reference layer",
    version: 2,
    collection: measuredCollection({ source: 2, output: 2, largestRow: 1 }, MONTH),
  },
  staleAfterSeconds: 2 * MONTH,
  /** Once a month: the recursoshidro-pontos-de-gua collection walked page by page from LNEG's OGC API, every feature with its geometry. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the collection's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
