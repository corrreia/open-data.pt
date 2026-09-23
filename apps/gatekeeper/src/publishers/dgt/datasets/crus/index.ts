import type { DatasetDefinition } from "#/catalog/define";

/*
 * The Carta do Regime de Uso do Solo is one dataset — every parcel of mainland
 * Portugal, classified the same way — so it is one feed and one product.
 *
 * It is also 234,768 parcels and 191 MB, read in 47 pages of five thousand.
 * That is a third of the million rows the kernel's own scale gate covers, and
 * well inside the limits a policy may declare, so nothing about its size calls
 * for cutting it into municipalities. What does have to be handled is the
 * service: walking it end to end, about one page in fifty comes back 502, and
 * every page must arrive for the collection to be whole. The reader tries a
 * failed page again rather than the dataset being shaped around a flaky
 * gateway.
 */
export const DATASET: DatasetDefinition = {
  title: "Mainland Portugal land-use regime (CRUS)",
  description:
    "Every parcel of mainland Portugal in the Carta do Regime de Uso do Solo — 234,768 of them, across all 278 municipalities — with the class and category of soil its municipal plan puts it in, the designation the plan uses, its area in hectares, the scale it was drawn at, where DGT took it from, whether the plan behind it is still in force, and that plan's deposit reference and publication date. Attributes only, without parcel outlines: Lisbon's 861 parcels alone carry nineteen megabytes of them.",
  licence: "cc-by-4.0",
  attribution: "Direção-Geral do Território — Carta do Regime de Uso do Solo",
  topics: ["cities", "government"],
};
