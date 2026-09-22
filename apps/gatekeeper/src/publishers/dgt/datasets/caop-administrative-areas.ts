import type { DatasetDefinition, FeedDefinition } from "../../../catalog/define";
import { WEEK, measuredCollection, type LayerSize } from "../../../formats/ogc/feeds";
import { DGT_HOST } from "../ogc";

/**
 * A layer whose budgets come from having read it, polled every week: the CAOP is
 * republished as a dated edition, not continuously, so weekly is frequent enough
 * to catch a correction.
 */
function measuredPolicy(name: string, measured: LayerSize): FeedDefinition["policy"] {
  return { name, version: 3, collection: measuredCollection(measured, WEEK) };
}

export const DATASET: DatasetDefinition = {
  title: "CAOP administrative areas",
  description: "Portugal's official administrative boundaries as DGT publishes them: districts, municipalities and parishes.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "government", "society"],
  feeds: [
    /*
     * DGT publishes the CAOP for Portugal Continental only: 18 districts, 278
     * municipalities and 3,049 parishes, with the Azores and Madeira absent from
     * these collections. Every title and description says so.
     *
     * What each of these does with its outlines was decided by reading it. The
     * parishes and the boundary segments are drawn, because no parish reaches the
     * megabyte a record may hold and they are what almost everything else joins
     * to. The districts, municipalities and NUTS regions are placed instead: each
     * of those layers holds outlines past that megabyte — one district is three
     * and a half of them — and they are in any case the parishes added together,
     * so nothing is lost that cannot be rebuilt from the parishes that are drawn.
     * Placing still means downloading the outline and keeping what says where the
     * area is and how far it reaches; the service offers no way to ask for less.
     */
    {
      slug: "dgt-caop-distritos-feed",
      title: "Mainland Portugal districts, placed (CAOP 2025)",
      description:
        "The 18 districts of mainland Portugal in the official administrative charter: code, name, NUTS 1 region, area, perimeter, and how many municipalities and parishes each holds, with where each one lies and how far it reaches. The outlines themselves are left at the source — one district alone is three and a half megabytes of coastline — and can be rebuilt from the parish boundaries, which are published whole. The Azores and Madeira are not part of this collection.",
      config: {
        source: "ogc",
        host: DGT_HOST,
        collection: "distritos",
        geometry: "point",
        pageSize: "10",
        maxPages: "6",
      },
      policy: measuredPolicy("CAOP weekly placed table", { source: 63, output: 1, largestRow: 1 }),
      staleAfterSeconds: 1_209_600,
    },
    {
      slug: "dgt-caop-municipios-feed",
      title: "Mainland Portugal municipalities, placed (CAOP 2025)",
      description:
        "The 278 municipalities of mainland Portugal in the official administrative charter: DTMN code, name, district, the three NUTS levels, area, perimeter, and parish count, with where each one lies and how far it reaches. The outlines themselves are left at the source, because two of the 278 run past the megabyte a record may hold; they can be rebuilt from the parish boundaries, which are published whole. The Azores and Madeira are not part of this collection.",
      config: {
        source: "ogc",
        host: DGT_HOST,
        collection: "municipios",
        geometry: "point",
        pageSize: "25",
        maxPages: "14",
      },
      policy: measuredPolicy("CAOP weekly placed table", { source: 194, output: 1, largestRow: 1 }),
      staleAfterSeconds: 1_209_600,
    },
    {
      slug: "dgt-caop-freguesias-feed",
      title: "Mainland Portugal parish boundaries (CAOP 2025)",
      description:
        "The 3,049 civil parishes of mainland Portugal in the official administrative charter, each with the ground it covers: DTMNFR code, name, municipality, district, the three NUTS levels, area and perimeter. This is the boundary nearly everything else joins to — a parcel, an easement or a plan that names a parish can be placed by it, and the municipalities, districts and NUTS regions are these outlines added together. The Azores and Madeira are not part of this collection.",
      config: {
        source: "ogc",
        host: DGT_HOST,
        collection: "freguesias",
        geometry: "include",
        pageSize: "100",
        maxPages: "34",
      },
      policy: measuredPolicy("CAOP weekly boundaries", { source: 506, output: 122, largestRow: 671 }),
      staleAfterSeconds: 1_209_600,
    },
    /*
     * The `admin` collection is deliberately not read. It holds the same 3,049
     * parishes split into their 3,392 disjoint parts: an island parish and its
     * mainland part become two rows carrying one parish's code, name, municipality
     * and NUTS levels. The parish feed now publishes each parish's whole outline,
     * multipart and all, so `admin` would republish every one of those columns a
     * second time to say something the geometry already says.
     *
     * `nuts1` is not read either: it is a single row, "Continente", whose columns
     * are the other tables added up.
     */
    {
      slug: "dgt-caop-nuts2-feed",
      title: "Mainland Portugal NUTS II regions, placed (CAOP 2025)",
      description:
        "The seven NUTS II regions the charter covers, with the code, the area in hectares, the perimeter, how many municipalities and parishes each holds, and where each one lies and how far it reaches. These are the regions most Portuguese and European statistics are published by, so they are what a figure keyed to a region can be drawn against. The outlines are left at the source, because the mainland regions pass the megabyte a record may hold. The Azores and Madeira appear here as regions of the statistical hierarchy, though their areas are not part of this collection.",
      config: {
        source: "ogc",
        host: DGT_HOST,
        collection: "nuts2",
        geometry: "point",
        pageSize: "10",
        maxPages: "4",
      },
      policy: measuredPolicy("CAOP weekly placed table", { source: 50, output: 1, largestRow: 1 }),
      staleAfterSeconds: 1_209_600,
    },
    {
      slug: "dgt-caop-nuts3-feed",
      title: "Mainland Portugal NUTS III sub-regions, placed (CAOP 2025)",
      description:
        "The 24 NUTS III sub-regions of mainland Portugal, with the code, the NUTS II region and NUTS I level above them, the area in hectares, the perimeter, how many municipalities and parishes each holds, and where each one lies and how far it reaches. This is the level the intermunicipal communities are drawn on and much regional statistics is published by. The outlines are left at the source: two of the 24 run past the megabyte a record may hold. The Azores and Madeira are not part of this collection.",
      config: {
        source: "ogc",
        host: DGT_HOST,
        collection: "nuts3",
        geometry: "point",
        pageSize: "10",
        maxPages: "5",
      },
      policy: measuredPolicy("CAOP weekly placed table", { source: 75, output: 1, largestRow: 1 }),
      staleAfterSeconds: 1_209_600,
    },
    {
      slug: "dgt-caop-trocos-feed",
      title: "Mainland Portugal administrative boundary segments (CAOP 2025)",
      description:
        "The 9,899 segments the administrative boundaries of mainland Portugal are drawn from, with the line each one follows: which area lies either side of it, whether it runs on land or along the coast, the order of boundary it carries, whether it is settled or still undefined, and how long it is. Where a parish outline says what an area covers, these say what each stretch of its edge is and who agreed to it.",
      config: {
        source: "ogc",
        host: DGT_HOST,
        collection: "trocos",
        geometry: "include",
        pageSize: "500",
        maxPages: "22",
      },
      policy: measuredPolicy("CAOP weekly boundaries", { source: 219, output: 67, largestRow: 397 }),
      staleAfterSeconds: 1_209_600,
    },
  ],
};
