import type { DatasetDefinition } from "#/catalog/define";
import { oeirasFeed } from "#/publishers/cm-oeiras/wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras vacant commercial premises",
  description: "Commercial premises recorded as unoccupied in Oeiras, each with its address, whether the record is still active, and the context noted for it.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["cities", "economy"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-estabelecimentos-desocupados-feed",
      layer: "w_com_serv_estabelecimento_desocupado",
      idField: "cod_estabelecimento",
    }),
  ],
};
