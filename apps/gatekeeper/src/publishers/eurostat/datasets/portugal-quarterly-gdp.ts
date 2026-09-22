import type { DatasetDefinition } from "#/catalog/define";
import { DAILY_STATISTICS, DAY } from "#/publishers/eurostat/eurostat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portugal quarterly gross domestic product",
  description: "Seasonally and calendar adjusted quarterly GDP for Portugal in chain-linked 2010 million euros.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["economy"],
  feeds: [
    {
      slug: "eurostat-portugal-quarterly-gdp",
      config: {
        source: "eurostat",
        dataset: "namq_10_gdp",
        filters: "freq=Q&geo=PT&na_item=B1GQ&s_adj=SCA&unit=CLV10_MEUR",
        lastTimePeriod: "80",
        lang: "EN",
      },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * DAY,
    },
  ],
};
