import type { DatasetDefinition } from "#/catalog/define";
import { snsMonthly } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Hospital births and caesarean sections",
  description: "Monthly births and caesarean sections by hospital.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [snsMonthly("sns-births-and-caesareans-feed", "partos-e-cesarianas", "7000")],
};
