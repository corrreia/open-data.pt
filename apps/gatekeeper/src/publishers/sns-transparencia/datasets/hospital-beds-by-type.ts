import type { DatasetDefinition } from "#/catalog/define";
import { health } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Acute hospital beds by type",
  description: "Reported acute-care beds by hospital and bed type, latest twelve reporting months. A capacity breakdown, not the existing inpatient occupancy-rate product.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health("sns-hospital-beds-by-type-feed", {
      dataset: "lotacao-praticada-por-tipo-de-cama",
      timeField: "tempo",
      period: "month",
      windowPeriods: "12",
      orderBy: "tempo DESC,regiao,instituicao,tipo_de_camas",
      dimensions: "regiao,instituicao,tipo_de_camas",
      series: "lotacao",
      units: "lotacao=beds",
    }),
  ],
};
