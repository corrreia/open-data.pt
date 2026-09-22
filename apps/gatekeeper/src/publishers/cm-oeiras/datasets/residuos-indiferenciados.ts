import type { DatasetDefinition } from "../../../catalog/define";
import { oeirasFeed } from "../wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras refuse containers",
  description:
    "Containers for undifferentiated refuse in Oeiras, with the street they stand on, the type of equipment, the capacity in litres and whether collection is collective.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["cities", "environment"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-residuos-indiferenciados-feed",
      layer: "w_residuos_indiferenciados",
      numberFields: "capacidade",
    }),
  ],
};
