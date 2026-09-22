import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_REFERENCE, PORTO_HOST } from "../ckan";

export const DATASET: DatasetDefinition = {
  title: "Porto loading and unloading zones",
  description: "Kerbside loading and unloading bays with their location and rules.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal do Porto via dadosabertos.cm-porto.pt",
  topics: ["cities", "mobility"],
  feeds: [
    {
      slug: "porto-loading-zones-feed",
      config: {
        source: "ckan",
        host: PORTO_HOST,
        dataset: "cargas-e-descargas",
        resource: "51dc9778-0735-428e-9b26-d08fc06eb5bf",
      },
      policy: DAILY_REFERENCE,
      staleAfterSeconds: 172_800,
    },
  ],
};
