import type { DatasetDefinition } from "../../../catalog/define";
import { MONTHLY_SERIES } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Monthly live births by area and sex",
  description: "Live births by the mother's NUTS 2024 area of residence and sex for January to June 2026.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["society"],
  feeds: [
    {
      slug: "ine-live-births",
      config: {
        source: "ine",
        indicator: "0012094",
        lang: "PT",
        dims: "Dim1=S3A202601,S3A202602,S3A202603,S3A202604,S3A202605,S3A202606",
      },
      policy: MONTHLY_SERIES,
      staleAfterSeconds: 1_209_600,
    },
  ],
};
