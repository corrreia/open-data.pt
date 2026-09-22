import type { DatasetDefinition } from "../../../catalog/define";
import { E_REDES_PERIODIC_SERIES, eRedes } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Grid capacity for new generation",
  description: "Connected, committed, and still available capacity for new generation at each E-REDES substation.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [eRedes("e-redes-grid-reception-capacity-feed", { portalDataset: "capacidade-rececao-rnd", orderBy: "chave", limit: "1000" }, E_REDES_PERIODIC_SERIES, 1_209_600)],
};
