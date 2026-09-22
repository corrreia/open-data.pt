import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais playgrounds",
  description: "Public playgrounds in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities"],
  feeds: [cascaisFeed("cascais-playgrounds-feed", "geocascais-parqueinfantil", "684f9e58-2c4f-4f5b-b0a1-a5455acbed64")],
};
