import { defineFeed } from "#/catalog/define";
import { SNS_DAILY_PERIODS, SNS_HOST } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-sickness-self-declarations-feed",
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "autodeclaracoes-de-doenca-dos-utentes",
    timeField: "des_dia",
    period: "day",
    windowPeriods: "60",
    orderBy: "des_dia DESC,tipo_origem,des_sexo,grupo_etario",
    dimensions: "tipo_origem,des_sexo,grupo_etario",
    series: "qtd_add",
    units: "qtd_add=declarations",
  },
  policy: SNS_DAILY_PERIODS,
  staleAfterSeconds: 172_800,
  /** Once a day: the latest 60 days of SNS Transparência's `autodeclaracoes-de-doenca-dos-utentes` dataset, by `des_dia`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `autodeclaracoes-de-doenca-dos-utentes` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `qtd_add`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
