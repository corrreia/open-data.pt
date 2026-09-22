import type { DatasetDefinition } from "#/catalog/define";
import { health } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "SNS Grávida pregnancy-line triage",
  description: "Monthly pregnancy-line triages and referral destinations by local health unit, latest twenty-four reporting months.",
  licence: "source-terms",
  attribution: "SNS Transparência",
  topics: ["health"],
  feeds: [
    health("sns-pregnancy-line-triage-feed", {
      dataset: "evolucao-mensal-linha-sns-gravida",
      timeField: "mes",
      period: "month",
      windowPeriods: "24",
      orderBy: "mes DESC,uls",
      dimensions: "uls",
      series: "n_tt_triag_snsgrav,n_triag_snsgrav_ac,n_triag_snsgrav_csp,n_triag_snsgrav_cah,n_triag_snsgrav_su,n_triag_snsgrav_inem",
      units:
        "n_tt_triag_snsgrav=triages,n_triag_snsgrav_ac=triages,n_triag_snsgrav_csp=triages,n_triag_snsgrav_cah=triages,n_triag_snsgrav_su=triages,n_triag_snsgrav_inem=triages",
    }),
  ],
};
