import type { DatasetDefinition } from "../../../catalog/define";
import { selectedSeries } from "../bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Growth in Portuguese exports and imports of goods",
  description:
    "Cumulative year-on-year percentage changes in the nominal value of Portuguese goods exports and imports, latest sixty monthly observations. These are cumulative growth rates, not month-on-month changes or vehicle registrations.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [
    // The research URL used domain 50 (vehicle registrations and fuel sales). Domain 53 shares
    // this dimension-set hash but actually contains Portuguese international trade observations.
    selectedSeries("bpstat-goods-trade-growth", "53", "34e4f2e4ddae13cba3e74c926fc23f48", [12587117, 12587123], 60),
  ],
};
