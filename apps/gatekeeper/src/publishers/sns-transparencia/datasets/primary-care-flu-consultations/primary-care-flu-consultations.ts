import { defineFeed } from "#/catalog/define";
import { SNS_DAILY_SERIES, SNS_HOST } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-primary-care-flu-consultations-feed",
  config: {
    host: SNS_HOST,
    dataset: "atendimentos-nos-csp-gripe",
    orderBy: "dia DESC,regiao",
    limit: "5000",
    series: "no_consultas_nos_csp,no_consultas_csp_programadas,no_consultas_csp_nao_programadas,no_consultas_gripe_nos_csp",
  },
  policy: SNS_DAILY_SERIES,
  staleAfterSeconds: 172_800,
  /** Twice a day: SNS Transparência's `atendimentos-nos-csp-gripe` dataset, up to 5000 records ordered by `dia DESC,regiao`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `atendimentos-nos-csp-gripe` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 4 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
