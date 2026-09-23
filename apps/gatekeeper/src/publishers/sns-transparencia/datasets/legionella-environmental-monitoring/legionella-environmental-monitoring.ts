import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_MONTHLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-legionella-environmental-monitoring-feed",
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "monitorizacao-ambiental-de-legionella",
    timeField: "tempo",
    orderBy: "tempo DESC,ponto_ou_localizacao_geografica",
    dimensions: "ponto_ou_localizacao_geografica",
    series:
      "no_total_amostras_analisadas,no_total_amostras_rede_predial,no_total_amostras_aguas_de_processo_torres_de_arrefecimento,no_total_amostras_minerais_naturais_agua_termais,no_total_amostras_piscinas,no_total_amostras_positivas,no_total_amostras_positivas_que_excedem_o_valor_parametrico",
    units:
      "no_total_amostras_analisadas=samples,no_total_amostras_rede_predial=samples,no_total_amostras_aguas_de_processo_torres_de_arrefecimento=samples,no_total_amostras_minerais_naturais_agua_termais=samples,no_total_amostras_piscinas=samples,no_total_amostras_positivas=samples,no_total_amostras_positivas_que_excedem_o_valor_parametrico=samples",
  },
  policy: SNS_MONTHLY_PERIODS,
  staleAfterSeconds: 5_184_000,
  /** Once a month: the latest reporting periods of SNS Transparência's `monitorizacao-ambiental-de-legionella` dataset, by `tempo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `monitorizacao-ambiental-de-legionella` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 7 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
