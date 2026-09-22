import type { DatasetDefinition } from "../../../catalog/define";
import { selectedSeries } from "../bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Portuguese Treasury-bond yields",
  description:
    "Daily fixed-rate Portuguese Treasury-bond yields for residual maturities of two, three, four, five, seven and ten years. Latest 366 observations per maturity; excludes monthly repetitions and German/US yields.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [selectedSeries("bpstat-portuguese-treasury-yields", "26", "690b7b36fd36c0dbe249c48cbbc39524", [12099454, 12099455, 12099456, 12099457, 12099458, 12099459], 366, 86_400)],
};
