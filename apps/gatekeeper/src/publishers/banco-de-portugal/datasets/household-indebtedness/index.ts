import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Household indebtedness and loan growth",
  description:
    "Portuguese household indebtedness and housing/consumer-loan amounts in millions of euros, plus source annual rates of change for housing and consumption/other-purpose loans. Latest sixty monthly observations; this particular dataset does not contain business indebtedness.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
};
