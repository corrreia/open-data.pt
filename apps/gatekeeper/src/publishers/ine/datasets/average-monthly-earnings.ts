import type { DatasetDefinition } from "../../../catalog/define";
import { ANNUAL_SERIES } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Average monthly earnings by area",
  description: "Annual average monthly earnings by NUTS 2024 geography for 2022 to 2024.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy"],
  feeds: [
    {
      slug: "ine-average-monthly-earnings",
      config: {
        source: "ine",
        indicator: "0012656",
        lang: "PT",
        dims: "Dim1=S7A2022,S7A2023,S7A2024",
      },
      policy: ANNUAL_SERIES,
      staleAfterSeconds: 5_184_000,
    },
  ],
};
