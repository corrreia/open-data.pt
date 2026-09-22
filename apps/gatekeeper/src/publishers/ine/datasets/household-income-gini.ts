import type { DatasetDefinition } from "#/catalog/define";
import { annualLatest } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Household income inequality: Gini coefficient",
  description: "Latest annual Gini coefficient of declared household income less assessed income tax, by NUTS 2024 geography.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy", "society"],
  feeds: [annualLatest("ine-household-income-gini", "0012744")],
};
