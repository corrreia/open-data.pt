import type { DatasetDefinition } from "../../../catalog/define";
import { selectedSeries } from "../bpstat/feeds";

export const DATASET: DatasetDefinition = {
  title: "Construction-sector business financial health",
  description:
    "Twelve quarterly ratios for private non-financial construction companies in Portugal: capital, profitability, debt, trade credit and payment periods. Latest twenty observations per series; not every business sector in the broader dataset.",
  licence: "bportugal-reuse",
  attribution: "Banco de Portugal, BPstat",
  topics: ["economy"],
  feeds: [
    selectedSeries(
      "bpstat-construction-business-financial-health",
      "168",
      "332441c9d65de71a0c842ac6496c1ee2",
      [12587167, 12587168, 12587169, 12587170, 12587171, 12587172, 12587173, 12587174, 12587175, 12587176, 12587177, 12587178],
      20,
      2_592_000,
    ),
  ],
};
