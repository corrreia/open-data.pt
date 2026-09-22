import type { DatasetDefinition } from "#/catalog/define";
import { snsDaily } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "INEM pre-hospital occurrences by priority",
  description: "Daily pre-hospital occurrences handled by INEM, split by triage priority.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [
    snsDaily(
      "sns-inem-occurrences-by-priority-feed",
      "numero-de-ocorrencia-com-prioridade",
      "periodo DESC",
      "1000",
      [
        "no_ocorrencias_emergentes_classificadas_com_prioridade_1_situacoes_associadas_a_risco_de_vida_iminen",
        "no_ocorrencias_muito_urgentes_classificadas_com_prioridade_2_situacoes_com_risco_clinico_elevado_pre",
        "no_ocorrencias_urgentes_classificadas_com_prioridade_3_situacoes_com_risco_de_agravamento_clinico_im",
        "no_ocorrencias_pouco_urgentes_classificadas_com_prioridade_4_situacoes_associadas_a_risco_clinico_ba",
        "no_ocorrencias_nao_urgentes_classificadas_com_prioridade_5_situacoes_que_nao_implicam_o_envio_de_mei",
        "no_ocorrencias_nao_urgentes_classificadas_com_outras_prioridades_sem_acionamento_de_meios",
      ].join(","),
    ),
  ],
};
