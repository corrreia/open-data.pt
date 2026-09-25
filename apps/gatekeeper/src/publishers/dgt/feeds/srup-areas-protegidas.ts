import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-areas-protegidas-feed",
  title: "Protected areas as a public-utility restriction",
  description:
    "The 71 classified protected areas of mainland Portugal — national, natural and regional parks, nature reserves, natural monuments and protected landscapes — each placed on the map with the ground it covers, and with the decree that created it, its date, the municipalities it spans and a link to the act. Where each one lies and how far it reaches is published; the outline itself is not, because two of the seventy-one run past the megabyte a record may hold.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  config: {
    host: DGT_HOST,
    collection: "srup_areas_protegidas",
    geometry: "point",
    pageSize: "33",
    maxPages: "5",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 34, output: 1, largestRow: 1 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_areas_protegidas layer walked page by page from DGT's OGC API, each feature placed by where it lies and how far it reaches. */
  fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
