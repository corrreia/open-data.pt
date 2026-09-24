import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_MONTHLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-blood-collection-feed",
  title: "Historical blood collection by institution and blood group",
  description:
    "Monthly blood units collected, including donors under 25, by region, institution and blood group, latest twelve reporting months. Null source measurements remain missing rather than becoming zero.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "colheita-de-sangue-total",
    timeField: "periodo",
    period: "month",
    windowPeriods: "12",
    orderBy: "periodo DESC,regiao,entidade,grupo_sanguineo",
    dimensions: "regiao,entidade,grupo_sanguineo",
    series: "no_total_de_unidades_de_sangue_colhidas,no_total_de_unidades_de_sangue_colhidas_no_grupo_etario_25_anos",
    units: "no_total_de_unidades_de_sangue_colhidas=blood units,no_total_de_unidades_de_sangue_colhidas_no_grupo_etario_25_anos=blood units",
  },
  policy: SNS_MONTHLY_PERIODS,
  staleAfterSeconds: 5_184_000,
  /** Once a month: the latest 12 months of SNS Transparência's `colheita-de-sangue-total` dataset, by `periodo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `colheita-de-sangue-total` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 2 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
