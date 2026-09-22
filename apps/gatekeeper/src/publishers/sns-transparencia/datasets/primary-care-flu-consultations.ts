import type { DatasetDefinition } from "../../../catalog/define";
import { snsDaily } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Primary-care consultations and flu activity",
  description: "Daily primary-care consultations by health region, including consultations for flu-like illness.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [
    snsDaily(
      "sns-primary-care-flu-consultations-feed",
      "atendimentos-nos-csp-gripe",
      "dia DESC,regiao",
      "5000",
      "no_consultas_nos_csp,no_consultas_csp_programadas,no_consultas_csp_nao_programadas,no_consultas_gripe_nos_csp",
    ),
  ],
};
