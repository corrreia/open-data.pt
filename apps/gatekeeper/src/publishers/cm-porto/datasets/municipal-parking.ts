import type { DatasetDefinition } from "#/catalog/define";
import { DAILY_REFERENCE, PORTO_HOST } from "#/publishers/cm-porto/ckan";

export const DATASET: DatasetDefinition = {
  title: "Porto municipal car parks",
  description: "Municipal car parks, capacities, management, and opening hours.",
  licence: "cc0-1.0",
  attribution: "Câmara Municipal do Porto via dadosabertos.cm-porto.pt",
  topics: ["cities", "mobility"],
  feeds: [
    {
      slug: "porto-municipal-parking-feed",
      config: {
        source: "ckan",
        host: PORTO_HOST,
        dataset: "parques-de-estacionamento-municipais",
        resource: "e9898000-f437-42d3-8c5b-22c5594052b2",
      },
      policy: DAILY_REFERENCE,
      staleAfterSeconds: 172_800,
    },
  ],
};
