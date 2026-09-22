import type { DatasetDefinition } from "../../../catalog/define";
import { oeirasFeed } from "../wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras bicycle parking",
  description:
    "Bicycle parking in Oeiras: the street and reference point, the number of docks and spaces, the type of stand, who is responsible for it, and when it was installed.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["cities", "mobility"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-docas-bicicletas-feed",
      layer: "w_bicicletas_docas_estacionamento",
      dateOnlyFields: "data_instalacao",
    }),
  ],
};
