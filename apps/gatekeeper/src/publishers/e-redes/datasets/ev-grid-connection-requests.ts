import type { DatasetDefinition } from "../../../catalog/define";
import { E_REDES_PERIODIC_SERIES, eRedes } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Grid connections for electric mobility",
  description: "Monthly grid-connection requests completed for electric-vehicle charging, by municipality.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    eRedes(
      "e-redes-ev-grid-connection-requests-feed",
      { portalDataset: "9-plr-mobilidade-eletrica", orderBy: "data DESC,cod_concelho", limit: "1500" },
      E_REDES_PERIODIC_SERIES,
      1_209_600,
    ),
  ],
};
