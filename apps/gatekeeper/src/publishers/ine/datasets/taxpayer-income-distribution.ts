import type { DatasetDefinition } from "../../../catalog/define";
import { ANNUAL_SERIES, annualLatest } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Declared income after assessed tax by income quintile",
  description:
    "Annual distribution of taxpayers' gross declared income less assessed income tax, by NUTS 2024 geography and income quintile. Uses the current indicator, not the discontinued NUTS 2013 series.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy", "society"],
  feeds: [annualLatest("ine-taxpayer-income-distribution", "0012759", { ...ANNUAL_SERIES, version: 2 })],
};
