import type { DatasetDefinition } from "../../../catalog/define";
import { SNS_MONTHLY_SERIES } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Access to primary-care medical consultations",
  description: "Monthly consultation use among registered primary-care patients, by primary-care area.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [
    {
      slug: "sns-primary-care-consultation-access-feed",
      config: {
        source: "opendatasoft",
        host: "transparencia.sns.gov.pt",
        dataset: "acesso-de-consultas-medicas-pela-populacao-inscrita",
        orderBy: "tempo DESC,entidade",
        limit: "7500",
      },
      policy: SNS_MONTHLY_SERIES,
      staleAfterSeconds: 1_209_600,
    },
  ],
};
