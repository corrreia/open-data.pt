import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais public schools",
  description: "Public schools in Cascais with their education level and location.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "society"],
  feeds: [cascaisFeed("cascais-public-schools-feed", "geocascais-estabelecimentoescolar", "b7b1fef2-960c-4934-a912-92f026ffd000")],
};
