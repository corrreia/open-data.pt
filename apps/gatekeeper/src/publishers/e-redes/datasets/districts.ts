import type { DatasetDefinition } from "#/catalog/define";

export const DATASET: DatasetDefinition = {
  title: "Portuguese districts",
  description: "E-REDES district boundaries and representative points for Portugal.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    {
      slug: "e-redes-districts-feed",
      config: {
        source: "opendatasoft",
        host: "e-redes.opendatasoft.com",
        dataset: "districts-portugal",
        orderBy: "dis_code",
        limit: "100",
      },
      policy: {
        name: "Opendatasoft reference snapshot",
        version: 1,
        collection: {
          cadenceSeconds: 86_400,
          timeoutSeconds: 180,
          maxBytes: 8 * 1024 * 1024,
          maxOutputBytes: 32 * 1024 * 1024,
          maxRecordBytes: 2 * 1024 * 1024,
          maxRecords: 20_000,
          historyMode: "changes",
        },
      },
      staleAfterSeconds: 172_800,
    },
  ],
};
