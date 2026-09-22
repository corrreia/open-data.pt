import type { DatasetDefinition } from "../../../catalog/define";
import { health } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Average medicine-package prices",
  description:
    "Average outpatient and generic medicine-package prices by health region, latest thirty-six reporting months. Not pharmacy-level retail prices; underlying expenditure and package counts are not republished here.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health("sns-medicine-package-prices-feed", {
      dataset: "preco-medio-por-embalagem",
      timeField: "tempo",
      period: "month",
      windowPeriods: "36",
      orderBy: "tempo DESC,regiao",
      dimensions: "regiao",
      series: "preco_medio_por_embalagem_ambulatorio,preco_medio_por_embalagem_genericos",
    }),
  ],
};
