import { defineFeed } from "#/catalog/define";
import { SNS_DAILY_SERIES, SNS_HOST } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-inem-occurrences-by-priority-feed",
  title: "INEM pre-hospital occurrences by priority",
  description: "Daily pre-hospital occurrences handled by INEM, split by triage priority.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  config: {
    host: SNS_HOST,
    dataset: "numero-de-ocorrencia-com-prioridade",
    orderBy: "periodo DESC",
    limit: "1000",
    series: [
      "no_ocorrencias_emergentes_classificadas_com_prioridade_1_situacoes_associadas_a_risco_de_vida_iminen",
      "no_ocorrencias_muito_urgentes_classificadas_com_prioridade_2_situacoes_com_risco_clinico_elevado_pre",
      "no_ocorrencias_urgentes_classificadas_com_prioridade_3_situacoes_com_risco_de_agravamento_clinico_im",
      "no_ocorrencias_pouco_urgentes_classificadas_com_prioridade_4_situacoes_associadas_a_risco_clinico_ba",
      "no_ocorrencias_nao_urgentes_classificadas_com_prioridade_5_situacoes_que_nao_implicam_o_envio_de_mei",
      "no_ocorrencias_nao_urgentes_classificadas_com_outras_prioridades_sem_acionamento_de_meios",
    ].join(","),
  },
  policy: SNS_DAILY_SERIES,
  staleAfterSeconds: 172_800,
  /** Twice a day: SNS Transparência's `numero-de-ocorrencia-com-prioridade` dataset, up to 1000 records ordered by `periodo DESC`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `numero-de-ocorrencia-com-prioridade` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 6 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
