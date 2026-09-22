import type { DatasetDefinition } from "../../../catalog/define";
import { MONTH } from "../../../formats/opendatasoft/feeds";
import { health } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Environmental Legionella monitoring",
  description:
    "Annual INSA environmental Legionella sample counts by sampling context and test outcome. All published years; source totals and positive-result figures are preserved as reported.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health(
      "sns-legionella-environmental-monitoring-feed",
      {
        dataset: "monitorizacao-ambiental-de-legionella",
        timeField: "tempo",
        orderBy: "tempo DESC,ponto_ou_localizacao_geografica",
        dimensions: "ponto_ou_localizacao_geografica",
        series:
          "no_total_amostras_analisadas,no_total_amostras_rede_predial,no_total_amostras_aguas_de_processo_torres_de_arrefecimento,no_total_amostras_minerais_naturais_agua_termais,no_total_amostras_piscinas,no_total_amostras_positivas,no_total_amostras_positivas_que_excedem_o_valor_parametrico",
        units:
          "no_total_amostras_analisadas=samples,no_total_amostras_rede_predial=samples,no_total_amostras_aguas_de_processo_torres_de_arrefecimento=samples,no_total_amostras_minerais_naturais_agua_termais=samples,no_total_amostras_piscinas=samples,no_total_amostras_positivas=samples,no_total_amostras_positivas_que_excedem_o_valor_parametrico=samples",
      },
      MONTH,
    ),
  ],
};
