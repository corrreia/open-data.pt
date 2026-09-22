import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_STATIC } from "../../../formats/gtfs/feeds";

export const DATASET: DatasetDefinition = {
  title: "CP GTFS",
  description: "Stops, routes, agencies and service days from CP's current static schedule archive. Not live service or delay information.",
  licence: "source-terms",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
  feeds: [
    {
      slug: "cp-gtfs-feed",
      config: {
        source: "gtfs",
        url: "https://publico.cp.pt/gtfs/gtfs.zip",
        files: "agency,stops,routes,calendar,calendar_dates",
      },
      policy: DAILY_STATIC,
      staleAfterSeconds: 259_200,
    },
  ],
};
