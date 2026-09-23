import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-rede-ferroviaria-feed",
  config: {
    host: DGT_HOST,
    collection: "srup_rede_ferroviaria",
    geometry: "include",
    pageSize: "140",
    maxPages: "6",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 57, output: 14, largestRow: 338 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_rede_ferroviaria layer walked page by page from DGT's OGC API, every feature with its outline. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
