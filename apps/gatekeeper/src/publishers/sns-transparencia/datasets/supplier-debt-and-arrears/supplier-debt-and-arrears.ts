import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_WEEKLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-supplier-debt-and-arrears-feed",
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "divida-total-vencida-e-pagamentos",
    timeField: "periodo",
    period: "month",
    windowPeriods: "24",
    orderBy: "periodo DESC,regiao,entidade",
    dimensions: "regiao,entidade",
    series: "divida_total_fornecedores_externos,divida_vencida_fornecedores_externos,pagamentos_em_atraso",
  },
  policy: SNS_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 24 months of SNS Transparência's `divida-total-vencida-e-pagamentos` dataset, by `periodo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `divida-total-vencida-e-pagamentos` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 3 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
