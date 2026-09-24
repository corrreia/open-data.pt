import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-sgifr-pontos-feed",
  title: "Rural fire management points",
  description:
    "The 7,841 points held in the sub-regional rural fire management programmes of mainland Portugal: 7,550 water points for firefighting, 172 lookout and detection posts, and the rest strategic fuel-break mosaics. Each carries the intermunicipal body that answers for it, the programme it belongs to and the notice that approved that programme.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  config: {
    host: DGT_HOST,
    collection: "sgifr_pontos",
    geometry: "include",
    pageSize: "500",
    maxPages: "18",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 7, output: 4, largestRow: 1 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the sgifr_pontos layer walked page by page from DGT's OGC API, every feature with its outline. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
