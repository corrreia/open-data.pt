import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais fire-fighting infrastructure",
  description: "Infrastructure for fighting fires in Cascais: the water points and installations crews draw on.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "environment", "society"],
  feeds: [cascaisFeed("cascais-fire-infrastructure-feed", "geocascais-infraestruturacombincendios", "b9cc4104-7c2f-4195-aa95-f84622554289")],
};
