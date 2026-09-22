import type { DatasetDefinition } from "../../../catalog/define";
import { annualLatest } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Declared income after assessed tax per inhabitant",
  description: "Latest annual gross declared income less assessed income tax per inhabitant, by NUTS 2024 geography.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy", "society"],
  feeds: [annualLatest("ine-declared-income-per-inhabitant", "0012672")],
};
