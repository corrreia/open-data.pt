import type { DatasetDefinition } from "#/catalog/define";
import { oeirasFeed } from "#/publishers/cm-oeiras/wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras municipal works",
  description:
    "The municipality's own works programme: each work's name, place, classification and type, the state it has reached, and the dates it is expected to start and finish.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["cities"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-obras-municipais-feed",
      layer: "w_obras_municipais",
      dateFields: "ultima_atualizacao",
      dateOnlyFields: "data_prevista_inicio,data_prevista_conclusao",
    }),
  ],
};
