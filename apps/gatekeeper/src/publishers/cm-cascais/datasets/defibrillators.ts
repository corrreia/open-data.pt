import type { DatasetDefinition } from "../../../catalog/define";
import { cascaisFeed } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Cascais public defibrillators",
  description: "Locations of automated external defibrillators available to the public in Cascais.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Cascais via dadosabertos.cascais.pt",
  topics: ["cities", "health"],
  feeds: [cascaisFeed("cascais-defibrillators-feed", "geocascais-desfibrilhador", "073e2257-3bb8-4065-a503-a901dff66295")],
};
