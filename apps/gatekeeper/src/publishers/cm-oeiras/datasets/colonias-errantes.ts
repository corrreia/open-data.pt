import type { DatasetDefinition } from "../../../catalog/define";
import { oeirasFeed } from "../wfs";

export const DATASET: DatasetDefinition = {
  title: "Oeiras stray cat colonies",
  description: "Registered stray cat colonies in Oeiras, each with the number of cats counted, how many of them are sterilised, and the state the colony has reached.",
  licence: "cc-by",
  attribution: "Câmara Municipal de Oeiras — Oeiras Interativa",
  topics: ["environment", "society"],
  feeds: [
    oeirasFeed({
      slug: "oeiras-colonias-errantes-feed",
      layer: "w_colonias_errantes",
    }),
  ],
};
