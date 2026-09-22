import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais drinking fountains",
  description: "Public drinking fountains in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities"],
  feeds: [cascaisFeed("cascais-drinking-fountains-feed", "geocascais-bebedouro", "271d3e44-c0d0-4123-85ff-5c5fc2db6c22")],
};
