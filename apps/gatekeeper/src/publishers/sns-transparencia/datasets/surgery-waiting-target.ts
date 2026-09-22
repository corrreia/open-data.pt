import type { DatasetDefinition } from "#/catalog/define";
import { SNS_MONTHLY_SERIES } from "#/publishers/sns-transparencia/opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Patients on surgery waiting lists within the 180-day target",
  description: "Monthly registered surgery patients within and outside the 180-day maximum response time, by hospital.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [
    {
      slug: "sns-surgery-waiting-target-feed",
      config: {
        source: "opendatasoft",
        host: "transparencia.sns.gov.pt",
        dataset: "inscritos-em-lic-dentro-do-tmrg-180-dias",
        orderBy: "tempo DESC,instituicao",
        limit: "5000",
      },
      policy: SNS_MONTHLY_SERIES,
      staleAfterSeconds: 1_209_600,
    },
  ],
};
