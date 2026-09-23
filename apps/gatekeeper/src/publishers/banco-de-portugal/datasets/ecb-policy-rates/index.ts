import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "ECB policy interest rates",
  description:
    "Main refinancing, marginal lending and deposit-facility rates applying to the euro area, including Portugal. Latest 366 daily observations for each of the three policy rates; other market-rate series are excluded.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
};
