import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-caop-municipios-feed",
  title: "Mainland Portugal municipalities, placed (CAOP 2025)",
  description:
    "The 278 municipalities of mainland Portugal in the official administrative charter: DTMN code, name, district, the three NUTS levels, area, perimeter, and parish count, with where each one lies and how far it reaches. The outlines themselves are left at the source, because two of the 278 run past the megabyte a record may hold; they can be rebuilt from the parish boundaries, which are published whole. The Azores and Madeira are not part of this collection.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "government", "society"],
  config: {
    host: DGT_HOST,
    collection: "municipios",
    geometry: "point",
    pageSize: "25",
    maxPages: "14",
  },
  policy: { name: "CAOP weekly placed table", version: 3, collection: measuredCollection({ source: 194, output: 1, largestRow: 1 }, WEEK) },
  staleAfterSeconds: 1_209_600,
  /** Every week: the CAOP's municipios collection walked page by page from DGT's OGC API, each area placed by where it lies and how far it reaches, its outline left behind. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the collection's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
