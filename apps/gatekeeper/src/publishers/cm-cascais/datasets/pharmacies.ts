import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais pharmacies",
  description: "Pharmacies in Cascais with addresses and locations.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "health"],
  feeds: [cascaisFeed("cascais-pharmacies-feed", "geocascais-farmacias", "94238d3f-4832-4927-977e-22e82940a9d9")],
};
