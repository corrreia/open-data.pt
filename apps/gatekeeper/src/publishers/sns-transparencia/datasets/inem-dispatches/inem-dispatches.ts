import { defineFeed } from "#/catalog/define";
import { SNS_DAILY_SERIES, SNS_HOST } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-inem-dispatches-feed",
  config: {
    host: SNS_HOST,
    dataset: "acionamentos-de-meios-de-emergencia-medica",
    orderBy: "periodo DESC",
    limit: "1000",
    series: [
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
  },
  policy: SNS_DAILY_SERIES,
  staleAfterSeconds: 172_800,
  /** Twice a day: SNS Transparência's `acionamentos-de-meios-de-emergencia-medica` dataset, up to 1000 records ordered by `periodo DESC`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `acionamentos-de-meios-de-emergencia-medica` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 10 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
