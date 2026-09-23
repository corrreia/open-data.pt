import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "New car-loan contract amount percentiles",
  description:
    "25th, 50th and 75th percentiles of new car-loan amounts, separately for new vehicles, used vehicles and all car loans in Portugal. Values are euros, not contract counts or APRs; latest thirty-six monthly observations.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
};
