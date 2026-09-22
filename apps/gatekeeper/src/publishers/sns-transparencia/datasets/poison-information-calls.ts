import type { DatasetDefinition } from "#/catalog/define";
import { health } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Poison information centre calls",
  description: "Monthly calls answered by the national poison information centre (CIAV), latest sixty reporting months.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health("sns-poison-information-calls-feed", {
      dataset: "evolucao-mensal-do-no-de-chamadas-atendidas-no-centro-de-informacao-antivenenos",
      timeField: "periodo",
      period: "month",
      windowPeriods: "60",
      orderBy: "periodo DESC",
      dimensions: "",
      series: "no_de_chamadas_atendidas_no_centro_de_informacao_antivenenos",
      units: "no_de_chamadas_atendidas_no_centro_de_informacao_antivenenos=calls",
    }),
  ],
};
