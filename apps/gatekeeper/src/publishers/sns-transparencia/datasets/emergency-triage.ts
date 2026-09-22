import type { DatasetDefinition } from "#/catalog/define";
import { snsMonthly } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Hospital emergency attendances by triage colour",
  description: "Monthly emergency attendances by hospital and Manchester triage priority, for about the last three years.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [
    snsMonthly(
      "sns-emergency-triage-feed",
      "atendimentos-em-urgencia-triagem-manchester",
      // Seven counts per row; the full table normalizes to more than 16 MiB.
      "3000",
    ),
  ],
};
