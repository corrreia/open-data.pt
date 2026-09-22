import type { DatasetDefinition } from "../../../catalog/define";
import { portugalMonthly } from "../eurostat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portugal monthly retail trade volume",
  description: "Seasonally and calendar adjusted volume of retail sales in Portugal, excluding vehicles, with 2021 equal to 100.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["economy"],
  feeds: [portugalMonthly("eurostat-portugal-retail-trade-volume", "sts_trtu_m", "freq=M&geo=PT&indic_bt=VOL_SLS&nace_r2=G47&s_adj=SCA&unit=I21")],
};
