import type { DatasetDefinition } from "#/catalog/define";
import { snsDaily } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "INEM emergency dispatches per day",
  description: "Daily dispatches of INEM helicopters, medical emergency cars, and ambulances.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [
    snsDaily(
      "sns-inem-dispatches-feed",
      "acionamentos-de-meios-de-emergencia-medica",
      "periodo DESC",
      "1000",
      [
        "no_de_acionamentos_das_ambulancias_de_emergencia_medica_aem",
        "no_de_acionamentos_das_ambulancias_de_suporte_imediato_de_vida_siv",
        "no_de_acionamentos_das_viaturas_medica_de_emergencia_e_reanimacao_vmer",
        "no_de_acionamentos_dos_motociclos_de_emergencia_medica_mem",
        "no_de_acionamentos_do_servico_de_helicopteros_de_emergencia_medica_shem",
        "no_de_acionamentos_de_ambulancias_de_transporte_inter_hospitalar_pediatrico_tip",
        "no_de_acionamentos_das_unidade_movel_de_intervencao_psicologica_de_emergencia_umipe",
        "no_de_acionamentos_das_ambulancias_de_socorro_sedeadas_em_postos_de_emergencia_medica_pem",
        "no_de_acionamentos_das_ambulancias_de_socorro_sedeadas_em_postos_reserva_res",
        "no_de_acionamentos_das_ambulancias_sedeadas_em_postos_nao_inem_ninem",
      ].join(","),
    ),
  ],
};
