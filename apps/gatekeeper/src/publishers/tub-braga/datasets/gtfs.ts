import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_STATIC } from "../../../formats/gtfs/feeds";

export const DATASET: DatasetDefinition = {
  title: "TUB Braga GTFS",
  description: "Stops, routes, agencies and service days, with route shapes, from TUB Braga's current static schedule archive. Not live service or delay information.",
  licence: "source-terms",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
  feeds: [
    {
      slug: "tub-braga-gtfs-feed",
      config: {
        source: "gtfs",
        url: "https://www.tub.pt/developer/gtfs/feed/tub.zip",
        files: "agency,stops,routes,calendar,calendar_dates,shapes",
      },
      policy: DAILY_STATIC,
      staleAfterSeconds: 259_200,
    },
  ],
};
