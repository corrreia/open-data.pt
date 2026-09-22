import type { DatasetDefinition } from "../../../catalog/define";
import { MONTHLY_SERIES } from "../ine/feeds";

export const DATASET: DatasetDefinition = {
  title: "Monthly employment rate by sex",
  description: "Employment rate among residents aged 16 to 74 by sex for February to July 2026.",
  licence: "cc-by-4.0",
  attribution: "Instituto Nacional de Estatística (INE)",
  topics: ["economy"],
  feeds: [
    {
      slug: "ine-employment-rate",
      config: {
        source: "ine",
        indicator: "0007971",
        lang: "PT",
        dims: "Dim1=S3A202602,S3A202603,S3A202604,S3A202605,S3A202606,S3A202607",
      },
      policy: MONTHLY_SERIES,
      staleAfterSeconds: 1_209_600,
    },
  ],
};
