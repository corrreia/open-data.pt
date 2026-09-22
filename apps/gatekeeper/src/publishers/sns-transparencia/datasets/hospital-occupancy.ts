import type { DatasetDefinition } from "../../../catalog/define";
import { snsMonthly } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Hospital inpatient occupancy",
  description: "Monthly inpatient days, staffed beds, and occupancy rate by hospital.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [snsMonthly("sns-hospital-occupancy-feed", "ocupacao-do-internamento", "8000")],
};
