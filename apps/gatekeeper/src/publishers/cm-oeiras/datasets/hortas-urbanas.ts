import type { DatasetDefinition } from "#/catalog/define";
import { oeirasFeed } from "#/publishers/cm-oeiras/wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras urban allotments",
  description: "Urban allotments in Oeiras with their area in square metres, the number of plots each holds, and the facilities supporting them.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["cities", "environment"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-hortas-urbanas-feed",
      layer: "w_hortas_urbanas",
      idField: "nome",
    }),
  ],
};
