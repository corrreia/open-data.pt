import type { DatasetDefinition } from "#/catalog/define";
import { oeirasFeed } from "#/publishers/cm-oeiras/wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras health facilities",
  description: "Health facilities and pharmacies in Oeiras with their address, telephone, email, opening hours, closing days and the body that runs each one.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["cities", "health"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-equipamentos-saude-feed",
      layer: "w_equipamentos_saude",
      idField: "nome",
    }),
  ],
};
