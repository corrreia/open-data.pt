import type { DatasetDefinition } from "#/catalog/define";
import { DAILY_STATISTICS } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Monthly overnight stays in tourist accommodation",
  description: "Monthly overnight stays by NUTS 2024 geography and accommodation type.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy"],
  feeds: [
    {
      slug: "ine-tourism-overnight-stays",
      config: { source: "ine", indicator: "0012092", lang: "PT" },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * 86_400,
    },
  ],
};
