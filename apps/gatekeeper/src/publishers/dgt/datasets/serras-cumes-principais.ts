import type { DatasetDefinition } from "../../../catalog/define";
import { geo2Feed } from "../wfs";

export const DATASET: DatasetDefinition = {
  title: "Principal mountain summits",
  description: "The 587 principal summits of the Portuguese mountain ranges, each with the range it crowns and its altitude in metres.",
  licence: "cc-by",
  attribution: "Direção-Geral do Território — Contributos para a delimitação das serras de Portugal",
  topics: ["culture", "environment"],
  feeds: [
    geo2Feed({
      slug: "dgt-serras-cumes-principais-feed",
      workspace: "serras_contributos",
      layer: "Cumes_principais",
      cadenceSeconds: 2_592_000,
      numberFields: "Altitude_m",
    }),
  ],
};
