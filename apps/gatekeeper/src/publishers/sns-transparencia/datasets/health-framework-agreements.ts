import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Health framework agreements",
  description: "Current health-sector framework agreements, suppliers, and validity dates published by SPMS.",
  licence: "source-terms",
  attribution: "SNS Transparência and the publisher named in the dataset metadata",
  topics: ["health"],
  feeds: [
    {
      slug: "sns-health-framework-agreements-feed",
      config: {
        source: "opendatasoft",
        host: "transparencia.sns.gov.pt",
        dataset: "acordos-quadro-na-area-da-saude",
        orderBy: "referencia_do_acordo_quadro",
        limit: "500",
      },
      policy: {
        name: "Opendatasoft changing reference data",
        version: 1,
        collection: {
          cadenceSeconds: 86_400,
          timeoutSeconds: 30,
          maxBytes: 2 * 1024 * 1024,
          historyMode: "changes",
        },
      },
      staleAfterSeconds: 2_592_000,
    },
  ],
};
