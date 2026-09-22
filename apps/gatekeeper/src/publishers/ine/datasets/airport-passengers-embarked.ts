import type { DatasetDefinition } from "#/catalog/define";
import { latestPeriod } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Passengers boarding at Portuguese airports",
  description: "Passengers embarked at each Portuguese airport in the latest month, by type of traffic.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["mobility"],
  feeds: [latestPeriod("ine-airport-passengers-embarked", "0000861")],
};
