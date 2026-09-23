import type { DatasetDefinition } from "#/catalog/define";

/*
 * The companion register of felled and transplanted trees (geocascais-arvoreintervencao)
 * is not read: its CSV streams past 48 MB and keeps growing, because it is an append-only
 * log of every intervention ever made. It is the portal's largest file by some way and the
 * least rewarding per byte. Read it if Cascais ever publishes it cut by year.
 */
export const DATASET: DatasetDefinition = {
  title: "Cascais street trees",
  description: "Trees standing in public space in Cascais, with their species and the place each stands.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "environment"],
};
