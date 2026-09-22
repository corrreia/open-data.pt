import type { DatasetDefinition } from "#/catalog/define";
import { LICENSED_DAILY_STATIC } from "#/formats/gtfs/feeds";

export const DATASET: DatasetDefinition = {
  title: "Transportes Colectivos do Barreiro GTFS",
  description:
    "Stops, routes, agencies and service days, with route shapes, from Transportes Colectivos do Barreiro's current static schedule archive. Not live service or delay information.",
  licence: "cc-by-4.0",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
  feeds: [
    {
      slug: "tcb-barreiro-gtfs-feed",
      // TCB's own open-data page names the licence: "A licença Creative Commons
      // Attribution 4.0 – CC BY 4.0 estabelece as condições de utilização."
      config: {
        source: "gtfs",
        url: "https://backend.tcbarreiro.pt/download-gtfs",
        files: "agency,stops,routes,calendar,calendar_dates,shapes",
      },
      policy: LICENSED_DAILY_STATIC,
      staleAfterSeconds: 259_200,
    },
  ],
};
