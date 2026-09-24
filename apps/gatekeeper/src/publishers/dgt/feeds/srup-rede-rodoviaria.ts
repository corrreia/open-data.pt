import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-rede-rodoviaria-feed",
  title: "National road network easements",
  description:
    "The 3,160 stretches of the national road network carrying an easement, each named for the road it belongs to — the A1, the EN2, a link ramp — and sorted into motorway, national road, regional road and municipal road, with the municipality it crosses. Porto holds 121 stretches, and each is drawn as it runs.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government", "mobility"],
  config: {
    host: DGT_HOST,
    collection: "srup_rede_viaria",
    geometry: "include",
    pageSize: "97",
    maxPages: "35",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 520, output: 125, largestRow: 423 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_rede_viaria layer walked page by page from DGT's OGC API, every feature with its outline. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
