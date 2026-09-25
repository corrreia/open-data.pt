import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-defesa-nacional-feed",
  title: "National defence easements",
  description:
    "The 152 military installations of mainland Portugal carrying a defence easement — barracks, forts and batteries — each with the ground it occupies, the act that established it, its date and the municipality it stands in. Lisbon holds 20.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government"],
  config: {
    host: DGT_HOST,
    collection: "srup_defesa_militar",
    geometry: "include",
    pageSize: "405",
    maxPages: "4",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 6, output: 1, largestRow: 725 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_defesa_militar layer walked page by page from DGT's OGC API, every feature with its outline. */
  fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
