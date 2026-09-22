import type { DatasetDefinition } from "../../../catalog/define";
import { latestPeriod } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "House price index",
  description: "Quarterly house price index by dwelling category, with 2015 equal to 100.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy"],
  feeds: [latestPeriod("ine-house-price-index", "0009201")],
};
