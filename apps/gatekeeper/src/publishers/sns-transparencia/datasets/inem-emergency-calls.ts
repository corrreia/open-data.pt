import type { DatasetDefinition } from "../../../catalog/define";
import { snsDaily } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "INEM emergency calls answered per day",
  description: "Emergency calls answered each day by INEM, the national medical emergency institute.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [snsDaily("sns-inem-emergency-calls-feed", "atividade-gripe-inem", "periodo DESC", "1000", "n_o_registos")],
};
