import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Euro banknotes put into circulation by Banco de Portugal",
  description:
    "Monthly number and euro value of banknotes put into circulation by Banco de Portugal, latest sixty observations per series. Excludes euro-area totals, coins and annual repetitions.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
};
