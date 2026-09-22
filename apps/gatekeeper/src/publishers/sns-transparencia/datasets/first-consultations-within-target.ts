import type { DatasetDefinition } from "#/catalog/define";
import { health } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "First hospital consultations within the response target",
  description:
    "First hospital consultations delivered within the maximum response time, registered first consultations and the reported proportion within target, latest twenty-four reporting months by hospital.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health("sns-first-consultations-within-target-feed", {
      dataset: "consultas-em-tempo-real",
      timeField: "tempo",
      period: "month",
      windowPeriods: "24",
      orderBy: "tempo DESC,regiao,instituicao",
      dimensions: "regiao,instituicao",
      series: "no_primeiras_ce_prestadas_dentro_do_tmrg,no_primeiras_ce_realizadas_com_registo_no_cth,1as_consultas_realizadas_em_tempo_adequado",
      units: "no_primeiras_ce_prestadas_dentro_do_tmrg=consultations,no_primeiras_ce_realizadas_com_registo_no_cth=consultations",
    }),
  ],
};
