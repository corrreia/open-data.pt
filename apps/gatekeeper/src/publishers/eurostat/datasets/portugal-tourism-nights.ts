import type { DatasetDefinition } from "#/catalog/define";
import { DAILY_STATISTICS, DAY } from "#/publishers/eurostat/eurostat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Nights in Portugal tourist accommodation",
  description: "Monthly nights spent by all residents in Portuguese hotels, short-stay accommodation, and camping sites.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["economy"],
  feeds: [
    {
      slug: "eurostat-portugal-tourism-nights",
      config: {
        source: "eurostat",
        dataset: "tour_occ_nim",
        filters: "c_resid=TOTAL&freq=M&geo=PT&nace_r2=I551-I553&unit=NR",
        lastTimePeriod: "120",
        lang: "EN",
      },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * DAY,
    },
  ],
};
