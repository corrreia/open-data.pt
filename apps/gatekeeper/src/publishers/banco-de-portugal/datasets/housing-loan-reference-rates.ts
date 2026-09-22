import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_STATISTICS } from "../bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Housing loans with other reference rates",
  description: "Monthly shares of new and outstanding permanent-home loans using reference rates outside the named benchmarks.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [
    {
      slug: "bpstat-housing-loan-reference-rates",
      config: {
        source: "bpstat",
        domain: "186",
        dataset: "63e8780cdb0c94c323528c7237b7a4b8",
        lang: "EN",
      },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * 86_400,
    },
  ],
};
