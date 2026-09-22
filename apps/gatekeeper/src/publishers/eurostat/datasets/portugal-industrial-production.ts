import type { DatasetDefinition } from "../../../catalog/define";
import { portugalMonthly } from "../eurostat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portugal monthly industrial production index",
  description: "Seasonally and calendar adjusted industrial production in Portugal, excluding construction, with 2021 equal to 100.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["economy"],
  feeds: [portugalMonthly("eurostat-portugal-industrial-production", "sts_inpr_m", "freq=M&geo=PT&indic_bt=PRD&nace_r2=B-D&s_adj=SCA&unit=I21")],
};
