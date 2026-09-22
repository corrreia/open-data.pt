import type { DatasetDefinition } from "../../../catalog/define";
import { annualLatest } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Median declared household income after assessed tax",
  description: "Latest annual median gross declared income less assessed income tax per tax household, by NUTS 2024 geography.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy", "society"],
  feeds: [annualLatest("ine-median-household-income-after-tax", "0012741")],
};
