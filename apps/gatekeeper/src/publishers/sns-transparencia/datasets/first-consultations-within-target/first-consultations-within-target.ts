import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_WEEKLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-first-consultations-within-target-feed",
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "consultas-em-tempo-real",
    timeField: "tempo",
    period: "month",
    windowPeriods: "24",
    orderBy: "tempo DESC,regiao,instituicao",
    dimensions: "regiao,instituicao",
    series: "no_primeiras_ce_prestadas_dentro_do_tmrg,no_primeiras_ce_realizadas_com_registo_no_cth,1as_consultas_realizadas_em_tempo_adequado",
    units: "no_primeiras_ce_prestadas_dentro_do_tmrg=consultations,no_primeiras_ce_realizadas_com_registo_no_cth=consultations",
  },
  policy: SNS_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 24 months of SNS Transparência's `consultas-em-tempo-real` dataset, by `tempo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `consultas-em-tempo-real` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 3 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
