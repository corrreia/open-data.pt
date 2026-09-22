import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais hotels",
  description: "Hotels and other tourist accommodation units in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "economy"],
  feeds: [cascaisFeed("cascais-hotels-feed", "geocascais-unidadehoteleira", "16f33130-4504-4304-9517-e02b1442025d")],
};
