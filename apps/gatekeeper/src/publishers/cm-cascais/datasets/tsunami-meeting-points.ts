import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais tsunami meeting points",
  description: "Evacuation meeting points to use in case of a tsunami warning in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "environment", "society"],
  feeds: [cascaisFeed("cascais-tsunami-meeting-points-feed", "geocascais-pontosencontrotsunami", "f6c7b517-7663-4f7c-bcd9-2db8cfab5036")],
};
