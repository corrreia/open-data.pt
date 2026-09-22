import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_STATISTICS } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Resident population by sex and age group",
  description: "Annual resident population by place of residence, sex, and life-cycle age group.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["society"],
  feeds: [
    {
      slug: "ine-resident-population",
      config: { source: "ine", indicator: "0004167", lang: "PT" },
      policy: DAILY_STATISTICS,
      staleAfterSeconds: 7 * 86_400,
    },
  ],
};
