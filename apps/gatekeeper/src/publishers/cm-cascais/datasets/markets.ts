import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais fairs and markets",
  description: "Municipal fairs and markets in Cascais with their location.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "economy"],
  feeds: [cascaisFeed("cascais-markets-feed", "geocascais-feiramercado", "52ac6f20-e436-4270-93c7-35d2529da157")],
};
