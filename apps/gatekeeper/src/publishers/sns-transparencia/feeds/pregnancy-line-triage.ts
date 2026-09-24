import { defineFeed } from "#/catalog/define";
import { SNS_HOST, SNS_WEEKLY_PERIODS } from "#/publishers/sns-transparencia/opendatasoft";
import { OPENDATASOFT_DEPLOYMENT, OPENDATASOFT_NORMALIZER, OPENDATASOFT_TRANSFORMER, OpendatasoftSource } from "#/formats/opendatasoft/index";

export const FEED = defineFeed(OPENDATASOFT_DEPLOYMENT, {
  slug: "sns-pregnancy-line-triage-feed",
  title: "SNS Grávida pregnancy-line triage",
  description: "Monthly pregnancy-line triages and referral destinations by local health unit, latest twenty-four reporting months.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  config: {
    host: SNS_HOST,
    limit: "10000",
    dataset: "evolucao-mensal-linha-sns-gravida",
    timeField: "mes",
    period: "month",
    windowPeriods: "24",
    orderBy: "mes DESC,uls",
    dimensions: "uls",
    series: "n_tt_triag_snsgrav,n_triag_snsgrav_ac,n_triag_snsgrav_csp,n_triag_snsgrav_cah,n_triag_snsgrav_su,n_triag_snsgrav_inem",
    units: "n_tt_triag_snsgrav=triages,n_triag_snsgrav_ac=triages,n_triag_snsgrav_csp=triages,n_triag_snsgrav_cah=triages,n_triag_snsgrav_su=triages,n_triag_snsgrav_inem=triages",
  },
  policy: SNS_WEEKLY_PERIODS,
  staleAfterSeconds: 1_209_600,
  /** Once a week: the latest 24 months of SNS Transparência's `evolucao-mensal-linha-sns-gravida` dataset, by `mes`. */
  fetch: ({ config, validator, library, fetch }) => new OpendatasoftSource(library.hosts, fetch).collect(config, validator),
  /** Once, walking back: one older slice of `evolucao-mensal-linha-sns-gravida` at a time, by the time field the portal annotates, until it has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => new OpendatasoftSource(library.hosts, fetch).collectHistory(config, cursor),
  /** The portal's metadata and records, into series of its 6 measures. */
  transform: { normalizer: OPENDATASOFT_NORMALIZER, streaming: (body, context) => OPENDATASOFT_TRANSFORMER.transform(body, context) },
});
