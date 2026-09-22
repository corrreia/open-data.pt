import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_STATISTICS, DAY } from "../eurostat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portugal quarterly house price index",
  description: "Quarterly index of all residential property purchases in Portugal, with 2015 equal to 100.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["economy"],
  feeds: [
    {
      slug: "eurostat-portugal-house-price-index",
      config: {
        source: "eurostat",
        dataset: "prc_hpi_q",
        filters: "freq=Q&geo=PT&purchase=TOTAL&unit=I15_Q",
        lastTimePeriod: "80",
        lang: "EN",
      },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * DAY,
    },
  ],
};
