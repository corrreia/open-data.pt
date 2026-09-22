import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais soft-mobility rental kiosks",
  description: "Kiosks in Cascais where bicycles and other soft-mobility vehicles are rented.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "mobility"],
  feeds: [cascaisFeed("cascais-rental-kiosks-feed", "geocascais-mobilidadesuave", "1fc3ad4f-2b6b-4779-ba9f-5c90b6260012")],
};
