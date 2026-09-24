import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_WEEKLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-hospital-beds-by-type-feed",
  title: "Acute hospital beds by type",
  description: "Reported acute-care beds by hospital and bed type, latest twelve reporting months. A capacity breakdown, not the existing inpatient occupancy-rate product.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "lotacao-praticada-por-tipo-de-cama",
    timeField: "tempo",
    period: "month",
    windowPeriods: "12",
    orderBy: "tempo DESC,regiao,instituicao,tipo_de_camas",
    dimensions: "regiao,instituicao,tipo_de_camas",
    series: "lotacao",
    units: "lotacao=beds",
  },
  policy: SNS_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 12 months of SNS Transparência's `lotacao-praticada-por-tipo-de-cama` dataset, by `tempo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `lotacao-praticada-por-tipo-de-cama` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `lotacao`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
