import type { DatasetDefinition } from "../../../catalog/define";
import { MONTH } from "../../../formats/opendatasoft/feeds";
import { health } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Historical blood collection by institution and blood group",
  description:
    "Monthly blood units collected, including donors under 25, by region, institution and blood group, latest twelve reporting months. Null source measurements remain missing rather than becoming zero.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health(
      "sns-blood-collection-feed",
      {
        dataset: "colheita-de-sangue-total",
        timeField: "periodo",
        period: "month",
        windowPeriods: "12",
        orderBy: "periodo DESC,regiao,entidade,grupo_sanguineo",
        dimensions: "regiao,entidade,grupo_sanguineo",
        series: "no_total_de_unidades_de_sangue_colhidas,no_total_de_unidades_de_sangue_colhidas_no_grupo_etario_25_anos",
        units: "no_total_de_unidades_de_sangue_colhidas=blood units,no_total_de_unidades_de_sangue_colhidas_no_grupo_etario_25_anos=blood units",
      },
      MONTH,
    ),
  ],
};
