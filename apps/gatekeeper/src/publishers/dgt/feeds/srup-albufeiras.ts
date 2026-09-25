import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-albufeiras-feed",
  title: "Classified public water reservoirs",
  description:
    "The 192 classified reservoirs of mainland Portugal, each placed on the map with the water it holds, sorted into protected, conditioned and freely used, with the ordinance that classified it and the municipalities around it. The outlines are left at the source: fifteen of the 192 run past the megabyte a record may hold.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["energy", "environment"],
  config: {
    host: DGT_HOST,
    collection: "srup_albufeiras",
    geometry: "point",
    pageSize: "12",
    maxPages: "18",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 253, output: 1, largestRow: 1 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_albufeiras layer walked page by page from DGT's OGC API, each feature placed by where it lies and how far it reaches. */
  fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
