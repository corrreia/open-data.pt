import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-reserva-agricola-feed",
  title: "National Agricultural Reserve delimitations in force",
  description:
    "The Reserva Agrícola Nacional as delimited for each of 269 mainland municipalities, with the ordinance or notice that set it, the issue of the Diário da República it appeared in, the date it took effect and a link to the act. Attributes only: one delimitation covers its whole municipality and runs to eight megabytes of outline, so reading it would cost a gigabyte and a third a week to say where a municipality is.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  config: {
    host: DGT_HOST,
    collection: "srup_ran",
    geometry: "skip",
    pageSize: "500",
    maxPages: "4",
    properties: "designacao,serv_dr,serv_data,serv_hiperligacao,serv_lei,municipio",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 1, output: 1, largestRow: 1 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_ran layer walked page by page from DGT's OGC API, its register columns without outlines. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
