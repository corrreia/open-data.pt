import type { DatasetDefinition } from "../../../catalog/define";
import { snsDaily } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "ÍCARO heat and mortality index",
  description: "INSA's daily ÍCARO index of the expected effect of heat on mortality, including the forecast days ahead.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [snsDaily("sns-icaro-heat-index-feed", "evolucao-diaria-do-indice-icaro", "periodo DESC", "1000")],
};
