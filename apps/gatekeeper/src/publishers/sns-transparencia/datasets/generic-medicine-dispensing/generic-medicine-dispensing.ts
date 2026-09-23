import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_WEEKLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-generic-medicine-dispensing-feed",
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "genericos",
    timeField: "tempo",
    period: "month",
    windowPeriods: "36",
    orderBy: "tempo DESC,regiao",
    dimensions: "regiao",
    series: "valor_pvp_genericos,unidades_dispensadas_genericos,qm_genericos_valor_pvp,qm_genericos_unidades_dispensadas",
    units: "unidades_dispensadas_genericos=dispensed units,qm_genericos_valor_pvp=ratio,qm_genericos_unidades_dispensadas=ratio",
  },
  policy: SNS_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 36 months of SNS Transparência's `genericos` dataset, by `tempo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `genericos` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 4 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
