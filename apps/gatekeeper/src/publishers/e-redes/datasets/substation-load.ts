import type { DatasetDefinition } from "../../../catalog/define";
import { E_REDES_PERIODIC_SERIES, eRedes } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Substation load",
  description: "Annual winter and summer load, installed power, and guaranteed power for each E-REDES substation.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    eRedes(
      "e-redes-substation-load-feed",
      { portalDataset: "carga-na-subestacao", orderBy: "ano DESC,codigo_da_instalacao,inverno_verao", limit: "1000" },
      E_REDES_PERIODIC_SERIES,
      1_209_600,
    ),
  ],
};
