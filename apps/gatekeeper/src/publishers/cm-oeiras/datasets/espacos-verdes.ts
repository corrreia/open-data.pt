import type { DatasetDefinition } from "#/catalog/define";
import { oeirasFeed } from "#/publishers/cm-oeiras/wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras green spaces",
  description: "Green spaces maintained by Oeiras, each with its typology, the street and parish it lies in, the park or garden it belongs to, and its area in square metres.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["cities", "environment"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-espacos-verdes-feed",
      layer: "w_espacos_verdes",
      numberFields: "area_m2",
    }),
  ],
};
