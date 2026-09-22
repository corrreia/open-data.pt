import type { DatasetDefinition } from "../../../catalog/define";
import { health } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Emergency calls transferred to SNS 24",
  description: "Monthly emergency calls transferred to the SNS 24 health line, latest sixty reporting months. Distinct from INEM's total calls answered.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health("sns-emergency-calls-transferred-sns24-feed", {
      dataset: "sns24",
      timeField: "data",
      period: "month",
      windowPeriods: "60",
      orderBy: "data DESC",
      dimensions: "",
      series: "n_o_de_chamadas_de_emergencia_transferidas_para_a_saude_24",
      units: "n_o_de_chamadas_de_emergencia_transferidas_para_a_saude_24=calls",
    }),
  ],
};
