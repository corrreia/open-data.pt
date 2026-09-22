import type { DatasetDefinition } from "../../../catalog/define";
import { MONTH } from "../../../formats/opendatasoft/feeds";
import { energy } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Distribution transformer stations by municipality",
  description:
    "A source-computed count of distribution transformer stations and their total installed capacity by municipality across the E-REDES service area. This is a municipal inventory summary, not individual station locations.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    energy(
      "e-redes-municipal-transformer-capacity-feed",
      {
        dataset: "postos-transformacao-distribuicao",
        select: "coddistritoconcelho,con_name,count(cod_instalacao) as station_count,sum(potencia_transformacao_kva) as potencia_transformacao_kva",
        groupBy: "coddistritoconcelho,con_name",
        orderBy: "coddistritoconcelho,con_name",
        idFields: "coddistritoconcelho,con_name",
        limit: "1000",
      },
      MONTH,
    ),
  ],
};
