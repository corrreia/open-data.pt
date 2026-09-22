import type { DatasetDefinition } from "#/catalog/define";
import { SNS_MONTHLY_SERIES } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Medicines dispensed by health region",
  description: "Monthly electronic and manual prescriptions dispensed and the amount paid by the SNS.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [
    {
      slug: "sns-dispensed-medicines-feed",
      config: {
        source: "opendatasoft",
        host: "transparencia.sns.gov.pt",
        dataset: "evolucao-da-dispensa-de-medicamentos",
        orderBy: "tempo DESC,regiao_de_saude",
        limit: "1000",
      },
      policy: SNS_MONTHLY_SERIES,
      staleAfterSeconds: 1_209_600,
    },
  ],
};
