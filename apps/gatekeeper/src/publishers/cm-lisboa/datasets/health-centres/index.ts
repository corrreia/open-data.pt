import type { DatasetDefinition } from "#/catalog/define";

/*
 * The health-centre dataset is read by three feeds — centres, pharmacies and
 * hospitals are three layers of one service, keyed and served alike — so each
 * says what it is within it.
 */
export const DATASET: DatasetDefinition = {
  title: "Lisbon health centres",
  description: "Locations and contact details for public health centres in Lisbon.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
};
