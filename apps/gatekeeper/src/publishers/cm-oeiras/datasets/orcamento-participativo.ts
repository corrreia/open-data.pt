import type { DatasetDefinition } from "#/catalog/define";
import { oeirasFeed } from "#/publishers/cm-oeiras/wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras participatory budget projects",
  description: "Projects chosen through the participatory budget of Oeiras, each with its description, the edition that chose it, and where it is being carried out.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["cities", "government"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-orcamento-participativo-feed",
      layer: "w_orcamento_participativo",
      idField: "nome",
    }),
  ],
};
