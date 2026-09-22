import type { DatasetDefinition } from "../../../catalog/define";
import { apaFeed } from "../arcgis";

export const DATASET: DatasetDefinition = {
  title: "Portugal bathing beaches",
  description: "Bathing-season dates, water-quality classification, facilities, and public information links for Portuguese beaches.",
  licence: "cc-by-4.0",
  attribution: "Agência Portuguesa do Ambiente — SNIAmb",
  topics: ["environment"],
  feeds: [
    apaFeed({
      slug: "apa-bathing-beaches-feed",
      title: "Portugal bathing beaches",
      description: "Bathing-season dates, water-quality classification, facilities, and public information links for Portuguese beaches.",
      service: "Praias",
    }),
    apaFeed({
      slug: "apa-blue-flag-beaches-feed",
      title: "Portugal Blue Flag beaches",
      description: "Beaches awarded the Blue Flag for the current bathing season.",
      service: "Praias",
      layer: "2",
    }),
  ],
};
