import type { DatasetDefinition } from "#/catalog/define";
import { annualLatest } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Households with broadband internet access",
  description:
    "Latest annual proportion of private households with at least one resident aged 16 to 74 and a home broadband connection, by NUTS 2024 area. These are aggregate survey statistics, not household-level records.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["society", "telecom"],
  feeds: [annualLatest("ine-household-broadband-access", "0013826")],
};
