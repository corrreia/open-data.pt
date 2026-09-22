import type { DatasetDefinition } from "#/catalog/define";
import { cascaisFeed } from "#/publishers/cm-cascais/ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais social charter",
  description: "The social charter of Cascais: the institutions and the social responses each offers.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "society"],
  feeds: [cascaisFeed("cascais-social-charter-feed", "geocascais-cartasocial", "18220143-de7f-42d0-a121-33fbaf00fb65")],
};
