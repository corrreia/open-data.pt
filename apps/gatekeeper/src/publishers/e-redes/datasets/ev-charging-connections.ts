import type { DatasetDefinition } from "../../../catalog/define";
import { E_REDES_PERIODIC_SERIES } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Electric-vehicle charging connection points",
  description: "The latest 1,000 quarterly charging connection aggregates by municipality and parish.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    {
      slug: "e-redes-ev-charging-connections-feed",
      config: {
        source: "opendatasoft",
        host: "e-redes.opendatasoft.com",
        dataset: "postos_carregamento_ves",
        orderBy: "trimestre DESC,coddistrito,coddistritoconcelho,coddistritoconcelhofreguesia,potencia_maxima_admissivel",
        limit: "1000",
      },
      policy: E_REDES_PERIODIC_SERIES,
      staleAfterSeconds: 1_209_600,
    },
  ],
};
