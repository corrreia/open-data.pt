import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais forest fire areas",
  description: "Areas burnt by recorded forest fires in Cascais, with their dates.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "environment"],
  feeds: [cascaisFeed("cascais-forest-fires-feed", "geocascais-incendioflorestal", "062d1d34-dce0-4a5a-bae1-99cc7f124bcf")],
};
