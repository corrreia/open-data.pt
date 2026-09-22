import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais health facilities",
  description: "Health centres, hospitals, and other health facilities in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "health"],
  feeds: [cascaisFeed("cascais-health-facilities-feed", "geocascais-equipamentosaude", "1f32f448-7ea4-4d16-a64b-9e4eb4fffa12")],
};
