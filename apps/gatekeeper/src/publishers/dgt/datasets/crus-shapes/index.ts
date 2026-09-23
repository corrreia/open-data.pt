import type { DatasetDefinition } from "#/catalog/define";

/*
 * The same charter as `dgt-crus`, with the outlines this time.
 *
 * Every parcel's boundary comes to 4.7 GiB and a quarter of an hour of
 * streaming, from a service that loses a connection every few minutes — one
 * sitting will not do it. So it is read a few municipalities a run, each one
 * twenty-two megabytes and a few seconds, and the runs pile up into a single
 * dataset: the kernel merges a partial snapshot into what is already served
 * rather than replacing it.
 *
 * Which municipalities exist is read from the administrative charter's own
 * codes rather than written down here, and `dtcc` on a parcel is that same
 * code — checked against Lisboa, 1106 either side. Sharding on the code rather
 * than the name also steps around the layer spelling Constância with an Ã.
 *
 * A partial snapshot cannot say a parcel is gone. What can is `dgt-crus-feed`,
 * which reads every row of the same collection without outlines, finishes in
 * one sitting, and is authoritative when it does: a shape whose parcel is no
 * longer in that table is a shape nothing references.
 */
export const DATASET: DatasetDefinition = {
  title: "Mainland Portugal land-use regime: parcel boundaries (CRUS)",
  description:
    "The boundary of every parcel in the Carta do Regime de Uso do Solo, with the class and category of soil its municipal plan puts it in. Read a few municipalities at a time and built up into one national layer, because the whole of it is 4.7 GiB of coordinates. Each boundary carries the same parcel identifier as the land-use table, so the two join on it: this feed says where a parcel is, and that one says whether it is still in force.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta do Regime de Uso do Solo",
  topics: ["cities", "government"],
};
