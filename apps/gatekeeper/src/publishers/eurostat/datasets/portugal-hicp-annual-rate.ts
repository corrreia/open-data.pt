import type { DatasetDefinition } from "#/catalog/define";
import { DAILY_STATISTICS, DAY } from "#/publishers/eurostat/eurostat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portugal harmonised inflation annual rate",
  description: "Monthly all-items Harmonised Index of Consumer Prices annual rate of change for Portugal.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["economy"],
  feeds: [
    {
      slug: "eurostat-portugal-hicp-annual-rate",
      config: {
        source: "eurostat",
        dataset: "prc_hicp_manr",
        filters: "coicop=CP00&freq=M&geo=PT",
        lastTimePeriod: "120",
        lang: "EN",
      },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * DAY,
    },
  ],
};
