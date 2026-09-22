import type { DatasetDefinition } from "../../../catalog/define";
import { health } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Generic medicine dispensing and market share",
  description:
    "Generic medicine expenditure, units dispensed and market shares by health region, latest thirty-six reporting months. Market shares are source fractions (0 to 1), despite percent annotations in the portal; no scaling is inferred.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health("sns-generic-medicine-dispensing-feed", {
      dataset: "genericos",
      timeField: "tempo",
      period: "month",
      windowPeriods: "36",
      orderBy: "tempo DESC,regiao",
      dimensions: "regiao",
      series: "valor_pvp_genericos,unidades_dispensadas_genericos,qm_genericos_valor_pvp,qm_genericos_unidades_dispensadas",
      units: "unidades_dispensadas_genericos=dispensed units,qm_genericos_valor_pvp=ratio,qm_genericos_unidades_dispensadas=ratio",
    }),
  ],
};
