import type { DatasetDefinition } from "#/catalog/define";
import { SNS_MONTHLY_SERIES } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Seasonal influenza vaccination coverage",
  description: "Annual estimated influenza vaccination coverage for Portugal, including age groups.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [
    {
      slug: "sns-seasonal-flu-vaccination-coverage-feed",
      config: {
        source: "opendatasoft",
        host: "transparencia.sns.gov.pt",
        dataset: "taxa-de-cobertura-da-vacina-antigripal-sazonal-na-populacao-em-portugal-continen",
        orderBy: "epoca_sazonal DESC",
        limit: "100",
      },
      policy: {
        ...SNS_MONTHLY_SERIES,
        name: "SNS annual series snapshot",
        collection: {
          ...SNS_MONTHLY_SERIES.collection,
          cadenceSeconds: 2_592_000,
        },
      },
      staleAfterSeconds: 5_184_000,
    },
  ],
};
