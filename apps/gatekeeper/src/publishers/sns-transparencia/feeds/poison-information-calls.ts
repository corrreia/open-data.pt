import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_WEEKLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-poison-information-calls-feed",
  title: "Poison information centre calls",
  description: "Monthly calls answered by the national poison information centre (CIAV), latest sixty reporting months.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "evolucao-mensal-do-no-de-chamadas-atendidas-no-centro-de-informacao-antivenenos",
    timeField: "periodo",
    period: "month",
    windowPeriods: "60",
    orderBy: "periodo DESC",
    dimensions: "",
    series: "no_de_chamadas_atendidas_no_centro_de_informacao_antivenenos",
    units: "no_de_chamadas_atendidas_no_centro_de_informacao_antivenenos=calls",
  },
  policy: SNS_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 60 months of SNS Transparência's `evolucao-mensal-do-no-de-chamadas-atendidas-no-centro-de-informacao-antivenenos` dataset, by `periodo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `evolucao-mensal-do-no-de-chamadas-atendidas-no-centro-de-informacao-antivenenos` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of `no_de_chamadas_atendidas_no_centro_de_informacao_antivenenos`. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
