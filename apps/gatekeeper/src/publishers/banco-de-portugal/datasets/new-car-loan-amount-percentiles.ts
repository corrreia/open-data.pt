import type { DatasetDefinition } from "#/catalog/define";
import { selectedSeries } from "#/publishers/banco-de-portugal/bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "New car-loan contract amount percentiles",
  description:
    "25th, 50th and 75th percentiles of new car-loan amounts, separately for new vehicles, used vehicles and all car loans in Portugal. Values are euros, not contract counts or APRs; latest thirty-six monthly observations.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [
    selectedSeries(
      "bpstat-new-car-loan-amount-percentiles",
      "209",
      "023d7ab3054d8a0d2db8de50c0ca394b",
      [13168888, 13168889, 13168890, 13168893, 13168894, 13168895, 13168898, 13168899, 13168900],
      36,
    ),
  ],
};
