import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais train stations",
  description: "Railway stations on the Cascais line within the municipality.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "mobility"],
  feeds: [cascaisFeed("cascais-train-stations-feed", "geocascais-estacaocomboios", "86545ad5-30a4-45c6-a311-e4a6d01d6762")],
};
