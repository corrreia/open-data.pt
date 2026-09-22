import type { DatasetDefinition } from "../../../catalog/define";
import { E_REDES_PERIODIC_SERIES, eRedes } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Energy communities and collective self-consumption",
  description: "Monthly count of energy communities and collective self-consumption schemes by parish.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    eRedes(
      "e-redes-energy-communities-feed",
      { portalDataset: "comunidades-de-energia", orderBy: "data DESC,codigo_freguesia,tipo_acc_cer", limit: "5000" },
      E_REDES_PERIODIC_SERIES,
      1_209_600,
    ),
  ],
};
