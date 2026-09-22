import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais commerce and services",
  description: "Commercial and service establishments in Cascais, with the activity of each.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "economy"],
  feeds: [cascaisFeed("cascais-commerce-services-feed", "geocascais-comercioservico", "1f30c5fa-acb7-4cab-859e-f0e549999609")],
};
