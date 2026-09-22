import type { DatasetDefinition } from "../../../catalog/define";
import { E_REDES_PERIODIC_SERIES } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Self-consumption electricity installations",
  description: "The latest 1,000 monthly self-consumption installation aggregates by place and technology.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    {
      slug: "e-redes-self-consumption-installations-feed",
      config: {
        source: "opendatasoft",
        host: "e-redes.opendatasoft.com",
        dataset: "8-total-upac-mensal",
        orderBy: "data DESC,coddistrito,codconcelho,codfreguesia,tipo_de_tecnologia,nivel_de_tensao,escalao_de_potencia_instalada",
        limit: "1000",
      },
      policy: E_REDES_PERIODIC_SERIES,
      staleAfterSeconds: 1_209_600,
    },
  ],
};
