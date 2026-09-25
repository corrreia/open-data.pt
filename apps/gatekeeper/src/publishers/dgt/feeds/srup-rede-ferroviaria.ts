import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-rede-ferroviaria-feed",
  title: "Railway easements",
  description:
    "The 502 stretches of railway in mainland Portugal carrying an easement, each drawn as it runs, with the act that established it, its date and the municipality it crosses.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government", "mobility"],
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
  fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
