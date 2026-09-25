import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-defesa-nacional-zonas-feed",
  title: "National defence protection zones",
  description:
    "The 149 protection zones around military installations in mainland Portugal, each with the ground it covers, the act that established it, its date and the municipality it lies in.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government"],
  config: {
    host: DGT_HOST,
    collection: "srup_defesa_militar_zonas",
    geometry: "include",
    pageSize: "397",
    maxPages: "4",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 6, output: 1, largestRow: 378 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_defesa_militar_zonas layer walked page by page from DGT's OGC API, every feature with its outline. */
  fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
