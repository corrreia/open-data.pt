import type { DatasetDefinition } from "../../../catalog/define";
import { SNS_MONTHLY_SERIES } from "../opendatasoft";

export const DATASET: DatasetDefinition = {
  title: "Hospital emergency attendances",
  description: "Monthly emergency attendances by hospital and type of emergency service.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [
    {
      slug: "sns-hospital-emergency-attendances-feed",
      config: {
        source: "opendatasoft",
        host: "transparencia.sns.gov.pt",
        dataset: "atendimentos-por-tipo-de-urgencia-hospitalar-link",
        orderBy: "tempo DESC,instituicao",
        limit: "7000",
      },
      policy: SNS_MONTHLY_SERIES,
      staleAfterSeconds: 1_209_600,
    },
  ],
};
