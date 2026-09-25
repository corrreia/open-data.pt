import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-captacoes-aguas-subterraneas-feed",
  title: "Protection zones around public groundwater abstraction",
  description:
    "The 949 protection perimeters around groundwater abstracted for public supply in mainland Portugal, with the ordinance that set each one, its date and the municipality it lies in. Pampilhosa da Serra and Góis hold 155 between them, and each perimeter is drawn.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "health"],
  config: {
    host: DGT_HOST,
    collection: "srup_aquiferos",
    geometry: "include",
    pageSize: "500",
    maxPages: "4",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 11, output: 3, largestRow: 358 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_aquiferos layer walked page by page from DGT's OGC API, every feature with its outline. */
  fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
