import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais taxi ranks",
  description: "Taxi ranks in Cascais with their location and number of places.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "mobility"],
  feeds: [cascaisFeed("cascais-taxi-ranks-feed", "geocascais-pracataxis", "7c2f6153-f9f9-488d-867c-ceb050e48d43")],
};
