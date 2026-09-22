import type { DatasetDefinition } from "../../../catalog/define";
import { selectedSeries } from "../bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Household indebtedness and loan growth",
  description:
    "Portuguese household indebtedness and housing/consumer-loan amounts in millions of euros, plus source annual rates of change for housing and consumption/other-purpose loans. Latest sixty monthly observations; this particular dataset does not contain business indebtedness.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [selectedSeries("bpstat-household-indebtedness", "18", "56ebacd8518e60ef58c85cb8185b4818", [12457868, 12457869, 12457924, 12458130, 12458133], 60)],
};
