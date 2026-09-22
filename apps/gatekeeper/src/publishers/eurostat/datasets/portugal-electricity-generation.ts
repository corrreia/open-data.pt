import type { DatasetDefinition } from "../../../catalog/define";
import { portugalMonthly } from "../eurostat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portugal monthly net electricity generation",
  description: "Total net electricity generation in Portugal each month, in gigawatt-hours.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["energy"],
  feeds: [portugalMonthly("eurostat-portugal-electricity-generation", "nrg_cb_pem", "freq=M&geo=PT&siec=TOTAL&unit=GWH")],
};
