import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_STATISTICS, DAY } from "../eurostat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portugal monthly unemployment rate",
  description: "Seasonally adjusted monthly unemployment rate for Portugal's total labour force.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["economy"],
  feeds: [
    {
      slug: "eurostat-portugal-monthly-unemployment",
      config: {
        source: "eurostat",
        dataset: "une_rt_m",
        filters: "age=TOTAL&freq=M&geo=PT&s_adj=SA&sex=T&unit=PC_ACT",
        lastTimePeriod: "120",
        lang: "EN",
      },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * DAY,
    },
  ],
};
