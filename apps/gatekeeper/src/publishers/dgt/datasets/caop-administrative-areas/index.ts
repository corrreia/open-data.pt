import type { DatasetDefinition } from "#/catalog/define";

/*
 * DGT publishes the CAOP for Portugal Continental only: 18 districts, 278
 * municipalities and 3,049 parishes, with the Azores and Madeira absent from
 * these collections. Every title and description says so.
 *
 * What each feed does with its outlines was decided by reading it. The
 * parishes and the boundary segments are drawn, because no parish reaches the
 * megabyte a record may hold and they are what almost everything else joins
 * to. The districts, municipalities and NUTS regions are placed instead: each
 * of those layers holds outlines past that megabyte — one district is three
 * and a half of them — and they are in any case the parishes added together,
 * so nothing is lost that cannot be rebuilt from the parishes that are drawn.
 * Placing still means downloading the outline and keeping what says where the
 * area is and how far it reaches; the service offers no way to ask for less.
 *
 * The `admin` collection is deliberately not read. It holds the same 3,049
 * parishes split into their 3,392 disjoint parts: an island parish and its
 * mainland part become two rows carrying one parish's code, name, municipality
 * and NUTS levels. The parish feed now publishes each parish's whole outline,
 * multipart and all, so `admin` would republish every one of those columns a
 * second time to say something the geometry already says.
 *
 * `nuts1` is not read either: it is a single row, "Continente", whose columns
 * are the other tables added up.
 *
 * Every feed's budgets come from having read its layer, polled every week: the
 * CAOP is republished as a dated edition, not continuously, so weekly is
 * frequent enough to catch a correction.
 */
export const DATASET: DatasetDefinition = {
  title: "CAOP administrative areas",
  description: "Portugal's official administrative boundaries as DGT publishes them: districts, municipalities and parishes.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta Administrativa Oficial de Portugal (CAOP) 2025",
  topics: ["cities", "government", "society"],
};
