import type { DatasetDefinition } from "../../../catalog/define";

export const DATASET: DatasetDefinition = {
  title: "National newborn screening programme",
  description: "Annual newborn screening activity and detected cases published by INSA.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [
    {
      slug: "sns-newborn-screening-feed",
      config: {
        source: "opendatasoft",
        host: "transparencia.sns.gov.pt",
        dataset: "programa-nacional-de-diagnostico-precoce",
        orderBy: "tempo",
        limit: "100",
      },
      policy: {
        name: "Opendatasoft slow series",
        version: 1,
        collection: {
          cadenceSeconds: 604_800,
          timeoutSeconds: 30,
          maxBytes: 2 * 1024 * 1024,
          historyMode: "changes",
        },
      },
      staleAfterSeconds: 1_209_600,
    },
  ],
};
