import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { MONTH, measuredCollection } from "#/formats/ogc/feeds";
import { LNEG_HOST } from "#/publishers/lneg/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "lneg-ocorrencias-minerais-feed",
  config: {
    host: LNEG_HOST,
    collection: "siorminp-mineral-occurrences",
    geometry: "include",
    pageSize: "500",
    maxPages: "13",
  },
  policy: {
    name: "LNEG monthly reference layer",
    version: 2,
    collection: measuredCollection({ source: 4, output: 4, largestRow: 3 }, MONTH),
  },
  staleAfterSeconds: 2 * MONTH,
  /** Once a month: the siorminp-mineral-occurrences collection walked page by page from LNEG's OGC API, every feature with its geometry. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the collection's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
