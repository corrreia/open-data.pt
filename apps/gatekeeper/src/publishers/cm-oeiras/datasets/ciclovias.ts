import type { DatasetDefinition } from "#/catalog/define";
import { oeirasFeed } from "#/publishers/cm-oeiras/wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras cycle network",
  description:
    "The cycle network of Oeiras segment by segment: its designation, typology and degree of segregation from traffic, its condition, length in metres, where it starts and ends, and the points of interest it serves.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["cities", "mobility"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-ciclovias-feed",
      layer: "w_ciclovias",
      // `data_construcao` is written day-first ("21/09/2002"), which is not a date this
      // library parses, so it is kept as the text the service publishes.
      numberFields: "extensao_m",
    }),
  ],
};
