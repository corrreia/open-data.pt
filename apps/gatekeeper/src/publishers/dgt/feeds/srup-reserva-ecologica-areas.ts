import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-reserva-ecologica-areas-feed",
  title: "National Ecological Reserve delimitations in force",
  description:
    "Every municipal delimitation of the Reserva Ecológica Nacional in force on the Portuguese mainland — 399 of them, each an ordinance or notice with the municipality it covers, the area it protects in hectares, whether it is the reserve itself or an exclusion from it, and a link to the act in the Diário da República. Attributes only: each delimitation is drawn across a whole municipality, so the ground it reaches is the municipality, which the charter already publishes.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  config: {
    host: DGT_HOST,
    collection: "srup_ren_areal",
    geometry: "skip",
    pageSize: "500",
    maxPages: "4",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 1, output: 1, largestRow: 1 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_ren_areal layer walked page by page from DGT's OGC API, its register columns without outlines. */
  fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
