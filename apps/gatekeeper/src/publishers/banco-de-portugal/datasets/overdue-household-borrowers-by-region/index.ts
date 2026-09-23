import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Household borrowers with overdue loans by region and purpose",
  description:
    "Percentage of household/NPISH borrowers with overdue housing or consumption/other-purpose loans in each of Portugal's nine NUTS II regions. Latest thirty-six monthly observations; these are borrower shares, not overdue loan balances or loan-value ratios.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
};
