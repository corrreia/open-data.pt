import type { DatasetDefinition } from "#/catalog/define";
import { selectedSeries } from "#/publishers/banco-de-portugal/bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "ECB policy interest rates",
  description:
    "Main refinancing, marginal lending and deposit-facility rates applying to the euro area, including Portugal. Latest 366 daily observations for each of the three policy rates; other market-rate series are excluded.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [selectedSeries("bpstat-ecb-policy-rates", "22", "471186a839daf97d9280419fc06c8579", [12504589, 12504590, 12504591], 366, 86_400)],
};
