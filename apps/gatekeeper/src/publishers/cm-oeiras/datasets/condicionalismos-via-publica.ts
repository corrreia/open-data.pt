import type { DatasetDefinition } from "#/catalog/define";
import { oeirasFeed } from "#/publishers/cm-oeiras/wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras public-road restrictions",
  description:
    "Every works restriction on the public road in Oeiras: what the work is, where it is, who asked for it, the state it has reached, the dates it was expected to start and finish, and when the record was last touched.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["cities", "mobility"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-condicionalismos-via-publica-feed",
      layer: "w_condicionalismos_via_publica",
      dateFields: "ultima_atualizacao",
      dateOnlyFields: "data_prevista_inicio,data_prevista_conclusao",
    }),
  ],
};
