import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-caop-nuts3-feed",
  title: "Mainland Portugal NUTS III sub-regions, placed (CAOP 2025)",
  description:
    "The 24 NUTS III sub-regions of mainland Portugal, with the code, the NUTS II region and NUTS I level above them, the area in hectares, the perimeter, how many municipalities and parishes each holds, and where each one lies and how far it reaches. This is the level the intermunicipal communities are drawn on and much regional statistics is published by. The outlines are left at the source: two of the 24 run past the megabyte a record may hold. The Azores and Madeira are not part of this collection.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "government", "society"],
  config: {
    host: DGT_HOST,
    collection: "nuts3",
    geometry: "point",
    pageSize: "10",
    maxPages: "5",
  },
  policy: { name: "CAOP weekly placed table", version: 3, collection: measuredCollection({ source: 75, output: 1, largestRow: 1 }, WEEK) },
  staleAfterSeconds: 1_209_600,
  /** Every week: the CAOP's nuts3 collection walked page by page from DGT's OGC API, each area placed by where it lies and how far it reaches, its outline left behind. */
  fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the collection's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
