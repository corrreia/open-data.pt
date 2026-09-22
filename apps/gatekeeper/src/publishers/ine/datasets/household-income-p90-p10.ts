import type { DatasetDefinition } from "../../../catalog/define";
import { annualLatest } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Household income inequality: P90/P10 ratio",
  description: "Latest annual ratio between the 90th and 10th percentiles of declared household income less assessed income tax, by NUTS 2024 geography.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy", "society"],
  feeds: [annualLatest("ine-household-income-p90-p10", "0012746")],
};
