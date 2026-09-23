import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_WEEKLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-emergency-calls-transferred-sns24-feed",
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "sns24",
    timeField: "data",
    period: "month",
    windowPeriods: "60",
    orderBy: "data DESC",
    dimensions: "",
    series: "n_o_de_chamadas_de_emergencia_transferidas_para_a_saude_24",
    units: "n_o_de_chamadas_de_emergencia_transferidas_para_a_saude_24=calls",
  },
  policy: SNS_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 60 months of SNS Transparência's `sns24` dataset, by `data`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `sns24` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `n_o_de_chamadas_de_emergencia_transferidas_para_a_saude_24`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
