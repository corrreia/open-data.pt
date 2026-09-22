import type { DatasetDefinition } from "../../../catalog/define";
import { health } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Sickness self-declarations by channel, sex and age",
  description: "Daily counts of sickness self-declarations, partitioned by source channel, sex and age group, latest sixty source reporting days. No individual health records.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health(
      "sns-sickness-self-declarations-feed",
      {
        dataset: "autodeclaracoes-de-doenca-dos-utentes",
        timeField: "des_dia",
        period: "day",
        windowPeriods: "60",
        orderBy: "des_dia DESC,tipo_origem,des_sexo,grupo_etario",
        dimensions: "tipo_origem,des_sexo,grupo_etario",
        series: "qtd_add",
        units: "qtd_add=declarations",
      },
      86_400,
    ),
  ],
};
