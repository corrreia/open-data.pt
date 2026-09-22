import type { DatasetDefinition } from "#/catalog/define";
import { DAILY_REFERENCE, PORTO_HOST } from "#/publishers/cm-porto/ckan";

export const DATASET: DatasetDefinition = {
  title: "Porto municipal trees",
  description: "Identified municipal trees with species, age range, and source geometry.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal do Porto via dadosabertos.cm-porto.pt",
  topics: ["cities", "environment"],
  feeds: [
    {
      slug: "porto-municipal-trees-feed",
      config: {
        source: "ckan",
        host: PORTO_HOST,
        dataset: "identificacao-e-caracterizacao-do-arvoredo-do-municipio-do-porto",
        resource: "ed573cc6-3c01-462d-b136-f6a4d059e9a6",
      },
      // About 72,000 trees: the 6.5 MB CSV normalizes to more than the 16 MiB default output cap.
      policy: {
        ...DAILY_REFERENCE,
        name: "Porto CKAN daily large reference snapshot",
        collection: { ...DAILY_REFERENCE.collection, timeoutSeconds: 180, maxOutputBytes: 64 * 1024 * 1024 },
      },
      staleAfterSeconds: 604_800,
    },
  ],
};
