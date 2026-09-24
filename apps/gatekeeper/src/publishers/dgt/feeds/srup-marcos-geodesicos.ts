import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-srup-marcos-geodesicos-feed",
  title: "Geodetic marks and their protection zones",
  description:
    "The 7,968 geodetic marks of mainland Portugal whose surroundings are protected by law, with the name each one is known by, the network it belongs to and the municipality it stands in. Odemira holds 193 of them. What is drawn is the protection zone around each mark rather than the mark itself. Every one of these is protected by the same 1982 decree, which the feed states once rather than on every row. This is the easement side of the register; the survey side, with each mark's order and height, is published separately from the geodetic network itself.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Servidões e Restrições de Utilidade Pública",
  topics: ["government", "society"],
  config: {
    host: DGT_HOST,
    collection: "srup_marcos_geod",
    geometry: "include",
    pageSize: "500",
    maxPages: "18",
    properties: "designacao,tipologia,municipio,dtccs",
  },
  policy: {
    name: "SRUP weekly register",
    version: 2,
    collection: measuredCollection({ source: 97, output: 25, largestRow: 3 }, WEEK),
  },
  staleAfterSeconds: 2 * WEEK,
  /** Every week: the srup_marcos_geod layer walked page by page from DGT's OGC API, every feature with its outline. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the layer's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
