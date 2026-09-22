import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_STATIC } from "../../../formats/gtfs/feeds";

export const DATASET: DatasetDefinition = {
  title: "Horários do Funchal GTFS",
  description: "Stops, routes, agencies and service days, with route shapes, from Horários do Funchal's current static schedule archive. Not live service or delay information.",
  licence: "source-terms",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
  feeds: [
    {
      slug: "horarios-do-funchal-gtfs-feed",
      // HF publishes service days only in calendar_dates.txt, not calendar.txt.
      config: {
        source: "gtfs",
        url: "https://www.horariosdofunchal.pt/googletransit.zip",
        files: "agency,stops,routes,calendar_dates,shapes",
      },
      policy: DAILY_STATIC,
      staleAfterSeconds: 259_200,
    },
  ],
};
