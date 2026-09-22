import type { DatasetDefinition } from "#/catalog/define";
import { DAILY_STATISTICS } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Monthly consumer price index",
  description: "Monthly consumer price index, 2025 base, by geography and special aggregate.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy"],
  feeds: [
    {
      slug: "ine-consumer-price-index",
      config: { source: "ine", indicator: "0014640", lang: "PT" },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * 86_400,
    },
  ],
};
