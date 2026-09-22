import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais fire stations",
  description: "Fire brigade stations in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "society"],
  feeds: [cascaisFeed("cascais-fire-stations-feed", "geocascais-quartelbombeiros", "8b4c8466-3df8-439c-9b3d-c5419395e916")],
};
