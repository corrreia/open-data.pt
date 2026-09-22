import type { DatasetDefinition } from "#/catalog/define";
import { ANNUAL_SERIES } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Median home sale price per square metre",
  description: "Annual median sale price of family homes by NUTS 2024 geography and home category for 2023 to 2025.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy"],
  feeds: [
    {
      slug: "ine-median-home-sale-price",
      config: {
        source: "ine",
        indicator: "0012255",
        lang: "PT",
        dims: "Dim1=S7A2023,S7A2024,S7A2025",
      },
      policy: ANNUAL_SERIES,
      staleAfterSeconds: 5_184_000,
    },
  ],
};
