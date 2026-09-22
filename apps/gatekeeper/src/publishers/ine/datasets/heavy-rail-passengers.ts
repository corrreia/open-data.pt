import type { DatasetDefinition } from "#/catalog/define";
import { latestPeriod } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Heavy rail passengers",
  description: "Passengers carried by heavy rail operators in the latest month, by type of service.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["mobility"],
  feeds: [latestPeriod("ine-heavy-rail-passengers", "0000901")],
};
