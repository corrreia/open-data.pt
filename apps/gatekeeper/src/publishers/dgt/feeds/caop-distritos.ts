import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-caop-distritos-feed",
  title: "Mainland Portugal districts, placed (CAOP 2025)",
  description:
    "The 18 districts of mainland Portugal in the official administrative charter: code, name, NUTS 1 region, area, perimeter, and how many municipalities and parishes each holds, with where each one lies and how far it reaches. The outlines themselves are left at the source — one district alone is three and a half megabytes of coastline — and can be rebuilt from the parish boundaries, which are published whole. The Azores and Madeira are not part of this collection.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "government", "society"],
  config: {
    host: DGT_HOST,
    collection: "distritos",
    geometry: "point",
    pageSize: "10",
    maxPages: "6",
  },
  policy: { name: "CAOP weekly placed table", version: 3, collection: measuredCollection({ source: 63, output: 1, largestRow: 1 }, WEEK) },
  staleAfterSeconds: 1_209_600,
  /** Every week: the CAOP's distritos collection walked page by page from DGT's OGC API, each area placed by where it lies and how far it reaches, its outline left behind. */
  fetch: ({ config, library, fetch }) => collectOgcFeed(config, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the collection's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
