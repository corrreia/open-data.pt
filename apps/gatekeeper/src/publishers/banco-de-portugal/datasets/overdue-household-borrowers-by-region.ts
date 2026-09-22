import type { DatasetDefinition } from "../../../catalog/define";
import { selectedSeries } from "../bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Household borrowers with overdue loans by region and purpose",
  description:
    "Percentage of household/NPISH borrowers with overdue housing or consumption/other-purpose loans in each of Portugal's nine NUTS II regions. Latest thirty-six monthly observations; these are borrower shares, not overdue loan balances or loan-value ratios.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [
    selectedSeries(
      "bpstat-overdue-household-borrowers-by-region",
      "188",
      "961306c1ed49daf795a53dc5fea4a04b",
      [
        12759854, 12759855, 12759861, 12759866, 12759871, 12759872, 12759884, 12760149, 12760153, 12760173, 12760174, 12760196, 12760197, 12760199, 12760204, 12760206, 12760515,
        12760516,
      ],
      36,
    ),
  ],
};
