import type { DatasetDefinition } from "../../../catalog/define";
import { selectedSeries } from "../bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Emigrant deposits by Portuguese NUTS II region",
  description:
    "Emigrant deposits domiciled in the nine Portuguese NUTS II regions, in millions of euros, latest thirty-six monthly observations. Excludes overlapping NUTS III totals, other depositors and accounts not assigned to a physical branch.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [
    selectedSeries(
      "bpstat-emigrant-deposits-by-region",
      "206",
      "d5bf6198a39f1e77b0d14dda97103de0",
      [12996746, 12996695, 12996702, 12996706, 12996708, 12996710, 12996715, 12996717, 12996719],
      36,
    ),
  ],
};
