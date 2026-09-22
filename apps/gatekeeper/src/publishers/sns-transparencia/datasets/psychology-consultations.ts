import type { DatasetDefinition } from "#/catalog/define";
import { health } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Psychology consultations by hospital",
  description: "First, subsequent and total psychology consultations by hospital and month, latest twenty-four reporting months.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health("sns-psychology-consultations-feed", {
      dataset: "evolucao-mensal-das-consultas-de-psicologia",
      timeField: "tempo",
      period: "month",
      windowPeriods: "24",
      orderBy: "tempo DESC,regiao,instituicao",
      dimensions: "regiao,instituicao",
      series: "psicologia_primeiras_consultas,psicologia_consultas_subsequentes,psicologia_total_de_consultas",
      units: "psicologia_primeiras_consultas=consultations,psicologia_consultas_subsequentes=consultations,psicologia_total_de_consultas=consultations",
    }),
  ],
};
