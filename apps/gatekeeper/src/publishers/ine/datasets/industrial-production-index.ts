import type { DatasetDefinition } from "../../../catalog/define";
import { latestPeriod } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Industrial production index",
  description: "Calendar and seasonally adjusted industrial production index for the latest month, with 2021 equal to 100.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy"],
  feeds: [latestPeriod("ine-industrial-production-index", "0011889")],
};
