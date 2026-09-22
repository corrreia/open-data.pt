import type { DatasetDefinition } from "../../../catalog/define";
import { portugalMonthly } from "../eurostat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portugal economic sentiment indicator",
  description: "Seasonally adjusted monthly economic sentiment indicator for Portugal.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["economy"],
  feeds: [portugalMonthly("eurostat-portugal-economic-sentiment", "ei_bssi_m_r2", "freq=M&geo=PT&indic=BS-ESI-I&s_adj=SA", "Index, long-term average = 100")],
};
