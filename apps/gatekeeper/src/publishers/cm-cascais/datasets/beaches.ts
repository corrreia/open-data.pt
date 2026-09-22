import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais beaches",
  description: "Beaches in Cascais with their location and facilities.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "environment"],
  feeds: [cascaisFeed("cascais-beaches-feed", "geocascais-praia", "0ba066ff-383d-484b-baf6-a7769c2316dd")],
};
