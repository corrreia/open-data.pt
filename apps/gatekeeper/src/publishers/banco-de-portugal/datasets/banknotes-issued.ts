import type { DatasetDefinition } from "../../../catalog/define";
import { selectedSeries } from "../bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Euro banknotes put into circulation by Banco de Portugal",
  description:
    "Monthly number and euro value of banknotes put into circulation by Banco de Portugal, latest sixty observations per series. Excludes euro-area totals, coins and annual repetitions.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [selectedSeries("bpstat-banknotes-issued", "9", "002abf63d5a4efb3e35ab5321251d7c5", [12468838, 12468839], 60)],
};
