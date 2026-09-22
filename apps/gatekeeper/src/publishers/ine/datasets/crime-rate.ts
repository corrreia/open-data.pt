import type { DatasetDefinition } from "#/catalog/define";
import { ANNUAL_SERIES } from "#/publishers/ine/ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Crime rate by area and category",
  description: "Annual recorded crime rate by NUTS 2013 geography and crime category for 2020 to 2022.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["society"],
  feeds: [
    {
      slug: "ine-crime-rate",
      config: {
        source: "ine",
        indicator: "0008074",
        lang: "PT",
        dims: "Dim1=S7A2020,S7A2021,S7A2022",
      },
      policy: ANNUAL_SERIES,
      staleAfterSeconds: 5_184_000,
    },
  ],
};
