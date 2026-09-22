import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais shared mobility stations",
  description: "Stations for shared bicycles and scooters in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "mobility"],
  feeds: [cascaisFeed("cascais-shared-mobility-stations-feed", "geocascais-estacaopartilhamicromobilidade", "6b19cc5b-7e82-4ba5-b5b0-747725a99b4e")],
};
