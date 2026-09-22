import type { DatasetDefinition } from "#/catalog/define";
import { latestPeriod } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Median bank valuation of housing",
  description: "Median bank valuation of housing per square metre by municipality and dwelling type, for the latest month.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy"],
  feeds: [latestPeriod("ine-median-bank-valuation", "0012248")],
};
