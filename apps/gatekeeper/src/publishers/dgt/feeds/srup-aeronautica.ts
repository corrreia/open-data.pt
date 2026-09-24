import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-aeronautica-feed",
  title: "Airport and aerodrome easements",
  description:
    "The 36 airports and aerodromes of mainland Portugal whose surroundings carry an aeronautical easement, each placed on the map with the ground its easement reaches, and with the decree that established it, its date, the municipalities it covers and a link to the act. The easement surfaces themselves are left at the source: four of the 36 run past the megabyte a record may hold.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government", "mobility"],
  config: {
    host: DGT_HOST,
    collection: "srup_aeronautica",
    geometry: "point",
    pageSize: "14",
    maxPages: "5",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 40, output: 1, largestRow: 1 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_aeronautica layer walked page by page from DGT's OGC API, each feature placed by where it lies and how far it reaches. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
