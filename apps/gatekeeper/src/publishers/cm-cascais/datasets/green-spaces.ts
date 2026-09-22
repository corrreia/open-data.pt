import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais green spaces",
  description: "Green spaces in Cascais, with the type and the area each covers.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "environment"],
  feeds: [cascaisFeed("cascais-green-spaces-feed", "geocascais-estruturaverde", "1814aa71-ab3b-4b19-8038-5f8c779ebd8c")],
};
