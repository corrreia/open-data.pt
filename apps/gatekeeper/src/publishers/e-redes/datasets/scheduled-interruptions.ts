import type { DatasetDefinition } from "#/catalog/define";
import { MEBIBYTE } from "#/formats/opendatasoft/feeds";

export const DATASET: DatasetDefinition = {
  title: "Scheduled electricity interruptions",
  description: "Planned interruption windows by municipality, parish, and postal code.",
  licence: "cc-by-4.0",
  attribution: "E-REDES",
  topics: ["energy"],
  feeds: [
    {
      slug: "e-redes-scheduled-interruptions-feed",
      config: {
        source: "opendatasoft",
        host: "e-redes.opendatasoft.com",
        dataset: "network-scheduling-work",
        orderBy: "updatedatetime DESC,startdatetime,zipcode",
        limit: "500",
      },
      policy: {
        name: "E-REDES scheduled interruption changes",
        version: 1,
        collection: {
          cadenceSeconds: 21_600,
          timeoutSeconds: 30,
          maxBytes: 2 * MEBIBYTE,
          historyMode: "changes",
        },
      },
      staleAfterSeconds: 43_200,
    },
  ],
};
