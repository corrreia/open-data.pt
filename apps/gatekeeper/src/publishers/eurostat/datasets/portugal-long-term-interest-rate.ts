import type { DatasetDefinition } from "#/catalog/define";
import { portugalMonthly } from "#/publishers/eurostat/eurostat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portugal long-term government bond yield",
  description: "Monthly 10-year government bond yield for Portugal used for the euro convergence criterion.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["economy"],
  feeds: [portugalMonthly("eurostat-portugal-long-term-interest-rate", "irt_lt_mcby_m", "freq=M&geo=PT&int_rt=MCBY", "Percentage per annum")],
};
