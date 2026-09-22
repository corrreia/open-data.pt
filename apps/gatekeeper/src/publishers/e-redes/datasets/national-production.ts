import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "National electricity production",
  description: "The latest 15-minute national electricity production measurements published by E-REDES.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    {
      slug: "e-redes-national-production-feed",
      config: {
        source: "opendatasoft",
        host: "e-redes.opendatasoft.com",
        dataset: "energia-produzida-total-nacional",
        orderBy: "datahora DESC",
        limit: "1000",
        series: "total,dgm,pre",
      },
      policy: {
        name: "Opendatasoft daily series subset",
        version: 1,
        collection: {
          cadenceSeconds: 21_600,
          timeoutSeconds: 180,
          maxBytes: 8 * 1024 * 1024,
          historyMode: "changes",
        },
      },
      staleAfterSeconds: 172_800,
    },
  ],
};
