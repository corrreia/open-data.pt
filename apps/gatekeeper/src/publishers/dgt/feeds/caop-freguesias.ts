import { defineFeed } from "#/catalog/define";
import { OGC_DEPLOYMENT, OGC_NORMALIZER, OGC_TRANSFORMER, collectOgcFeed } from "#/formats/ogc/index";
import { WEEK, measuredCollection } from "#/formats/ogc/feeds";
import { DGT_HOST } from "#/publishers/dgt/ogc";

export const FEED = defineFeed(OGC_DEPLOYMENT, {
  slug: "dgt-caop-freguesias-feed",
  title: "Mainland Portugal parish boundaries (CAOP 2025)",
  description:
    "The 3,049 civil parishes of mainland Portugal in the official administrative charter, each with the ground it covers: DTMNFR code, name, municipality, district, the three NUTS levels, area and perimeter. This is the boundary nearly everything else joins to — a parcel, an easement or a plan that names a parish can be placed by it, and the municipalities, districts and NUTS regions are these outlines added together. The Azores and Madeira are not part of this collection.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "government", "society"],
  config: {
    host: DGT_HOST,
    collection: "freguesias",
    geometry: "include",
    pageSize: "100",
    maxPages: "34",
  },
  policy: { name: "CAOP weekly boundaries", version: 3, collection: measuredCollection({ source: 506, output: 122, largestRow: 671 }, WEEK) },
  staleAfterSeconds: 1_209_600,
  /** Every week: the CAOP's freguesias collection walked page by page from DGT's OGC API, every feature with its outline. */
  fetch: ({ config, state, library, fetch }) => collectOgcFeed(config, state, library.hosts, fetch),
  /** The service's pages, streamed, into one table of the collection's features. */
  transform: { normalizer: OGC_NORMALIZER, streaming: (body, context) => OGC_TRANSFORMER.transform(body, context) },
});
