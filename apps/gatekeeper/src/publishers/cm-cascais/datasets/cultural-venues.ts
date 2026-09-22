import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais cultural venues",
  description: "Museums, theatres, libraries, and other cultural venues in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "culture"],
  feeds: [cascaisFeed("cascais-cultural-venues-feed", "geocascais-equipamentocultural", "9b899d53-8e7f-4d61-bac1-86449853a87b")],
};
