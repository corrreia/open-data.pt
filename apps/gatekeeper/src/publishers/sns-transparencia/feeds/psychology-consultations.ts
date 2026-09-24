import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_WEEKLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-psychology-consultations-feed",
  title: "Psychology consultations by hospital",
  description: "First, subsequent and total psychology consultations by hospital and month, latest twenty-four reporting months.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "evolucao-mensal-das-consultas-de-psicologia",
    timeField: "tempo",
    period: "month",
    windowPeriods: "24",
    orderBy: "tempo DESC,regiao,instituicao",
    dimensions: "regiao,instituicao",
    series: "psicologia_primeiras_consultas,psicologia_consultas_subsequentes,psicologia_total_de_consultas",
    units: "psicologia_primeiras_consultas=consultations,psicologia_consultas_subsequentes=consultations,psicologia_total_de_consultas=consultations",
  },
  policy: SNS_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 24 months of SNS Transparência's `evolucao-mensal-das-consultas-de-psicologia` dataset, by `tempo`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `evolucao-mensal-das-consultas-de-psicologia` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 3 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
