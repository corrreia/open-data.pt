import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-arvores-interesse-publico-pontos-feed",
  title: "Trees of public interest",
  description:
    "The 551 individual trees and groves classified as being of public interest in mainland Portugal, where each one stands, its species, whether it is a single tree or a group, and the notice that classified it. Lisbon holds 84 of them and Marinha Grande 34; the oldest classification here dates from 1947.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["culture", "environment"],
  config: {
    host: DGT_HOST,
    collection: "srup_arvores_point",
    geometry: "include",
    pageSize: "500",
    maxPages: "4",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 1, output: 1, largestRow: 1 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_arvores_point layer walked page by page from DGT's OGC API, every feature with its outline. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
