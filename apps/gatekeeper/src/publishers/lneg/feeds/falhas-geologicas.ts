import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { MONTH, measuredCollection } from "#/formats/ogc/feeds";
import { LNEG_HOST } from "#/publishers/lneg/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "lneg-falhas-geologicas-feed",
  title: "Geological faults at 1:1,000,000",
  description: "The 297 faults of the harmonised 1:1,000,000 geological map of Portugal, each with the kind of fault it is and the vocabulary term LNEG classifies it under.",
  licence: "cc-by-4.0",
  attribution: "Laboratório Nacional de Energia e Geologia",
  topics: ["environment"],
  config: {
    host: LNEG_HOST,
    collection: "cgp1m-ge-geologicfault",
    geometry: "include",
    pageSize: "500",
    maxPages: "4",
  },
  policy: {
    name: "LNEG monthly reference layer",
    version: 2,
    collection: measuredCollection({ source: 1, output: 1, largestRow: 10 }, MONTH),
  },
  staleAfterSeconds: 2 * MONTH,
  /** Once a month: the cgp1m-ge-geologicfault collection walked page by page from LNEG's OGC API, every feature with its geometry. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the collection's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
