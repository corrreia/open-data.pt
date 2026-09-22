import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais sports facilities",
  description: "Sports facilities in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "society"],
  feeds: [cascaisFeed("cascais-sports-facilities-feed", "geocascais-equipamentodesportivo", "de595b77-b9b3-45d7-abd5-cf1a0ab98439")],
};
