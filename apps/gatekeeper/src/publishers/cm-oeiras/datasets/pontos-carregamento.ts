import type { DatasetDefinition } from "../../../catalog/define";
import { oeirasFeed } from "../wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras electric-vehicle charging points",
  description: "Charging points in Oeiras with their MOBI.E identifier, operator, charging power, voltage level, connector format and sockets.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["energy", "mobility"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-pontos-carregamento-feed",
      layer: "w_pontos_carregamento",
    }),
  ],
};
