import type { DatasetDefinition } from "#/catalog/define";
import { DAILY_STATISTICS } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Monthly unemployment rate by age group",
  description: "Monthly unemployment rate for people aged 16 to 74, split by age group.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy"],
  feeds: [
    {
      slug: "ine-unemployment-rate",
      config: { source: "ine", indicator: "0007976", lang: "PT" },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * 86_400,
    },
  ],
};
