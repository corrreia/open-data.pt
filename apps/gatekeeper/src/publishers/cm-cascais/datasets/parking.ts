import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais parking",
  description: "Parking areas in Cascais, with the kind of parking each provides and the spaces it holds.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "mobility"],
  feeds: [cascaisFeed("cascais-parking-feed", "geocascais-estacionamento", "a052d6cc-5120-4ede-a2e6-dd707022660d")],
};
