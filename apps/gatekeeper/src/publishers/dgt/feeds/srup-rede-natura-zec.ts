import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-rede-natura-zec-feed",
  title: "Natura 2000 Special Areas of Conservation",
  description:
    "The 65 Zonas Especiais de Conservação of the Natura 2000 network on the Portuguese mainland, with their outlines, the phase of the national site list each belongs to, the decree that designated it, its date and the municipalities it covers.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  config: {
    host: DGT_HOST,
    collection: "srup_zec",
    geometry: "include",
    pageSize: "19",
    maxPages: "6",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 53, output: 13, largestRow: 750 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_zec layer walked page by page from DGT's OGC API, every feature with its outline. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
