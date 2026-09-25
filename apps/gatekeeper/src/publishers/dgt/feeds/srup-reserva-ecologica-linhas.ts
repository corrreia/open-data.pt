import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-reserva-ecologica-linhas-feed",
  title: "National Ecological Reserve watercourse delimitations",
  description:
    "The 138 linear delimitations of the Reserva Ecológica Nacional — watercourses and the ten-metre beds either side of them — with the act that set each one, its date and the municipality it covers. Attributes only, for the same reason as the areas: a delimitation spans its whole municipality.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["environment", "government"],
  config: {
    host: DGT_HOST,
    collection: "srup_ren_linear",
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
  /** Every week: the srup_ren_linear layer walked page by page from DGT's OGC API, its register columns without outlines. */
  fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
