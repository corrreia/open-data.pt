import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais municipal housing",
  description: "Buildings of municipal housing in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "society"],
  feeds: [cascaisFeed("cascais-municipal-housing-feed", "geocascais-habitacaomunicipal", "35e169ef-c209-4f44-971a-aba56990cbf4")],
};
