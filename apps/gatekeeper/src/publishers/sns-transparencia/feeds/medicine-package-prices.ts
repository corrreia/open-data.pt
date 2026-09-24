import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_WEEKLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-medicine-package-prices-feed",
  title: "Average medicine-package prices",
  description:
    "Average outpatient and generic medicine-package prices by health region, latest thirty-six reporting months. Not pharmacy-level retail prices; underlying expenditure and package counts are not republished here.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "preco-medio-por-embalagem",
    timeField: "tempo",
    period: "month",
    windowPeriods: "36",
    orderBy: "tempo DESC,regiao",
    dimensions: "regiao",
    series: "preco_medio_por_embalagem_ambulatorio,preco_medio_por_embalagem_genericos",
  },
  policy: SNS_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 36 months of SNS Transparência's `preco-medio-por-embalagem` dataset, by `tempo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `preco-medio-por-embalagem` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 2 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
