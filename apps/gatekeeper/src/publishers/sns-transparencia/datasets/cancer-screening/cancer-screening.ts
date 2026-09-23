import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_WEEKLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-cancer-screening-feed",
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "rastreios-oncologicos",
    timeField: "tempo",
    period: "month",
    windowPeriods: "24",
    orderBy: "tempo DESC,regiao,area_csp",
    dimensions: "regiao,area_csp",
    series:
      "contagem_de_mulheres_com_registo_de_mamografia_nos_ultimos_dois_anos,proporcao_mulheres_50_70_a_c_mamogr_2_anos,contagem_de_mulheres_com_colpocitologia_atualizada,proporcao_mulheres_25_60_a_c_colpoc_atuali,contagem_de_utentes_inscritos_com_rastreio_do_cancro_do_colon_e_reto_efetuado,proporcao_utentes_50_75_a_c_rastreio_cancro_cr",
    units:
      "contagem_de_mulheres_com_registo_de_mamografia_nos_ultimos_dois_anos=women,contagem_de_mulheres_com_colpocitologia_atualizada=women,contagem_de_utentes_inscritos_com_rastreio_do_cancro_do_colon_e_reto_efetuado=patients",
  },
  policy: SNS_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 24 months of SNS Transparência's `rastreios-oncologicos` dataset, by `tempo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `rastreios-oncologicos` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 6 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
