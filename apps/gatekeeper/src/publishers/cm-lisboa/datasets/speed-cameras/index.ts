import type { DatasetDefinition } from "#/catalog/define";

/*
 * The radars and the message panels are two layers of one service, and one
 * dataset: each says which of the two it is.
 */
export const DATASET: DatasetDefinition = {
  title: "Lisbon speed cameras",
  description: "Locations of fixed speed cameras on Lisbon roads.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal de Lisboa — Lisboa Aberta",
  topics: ["cities"],
};
