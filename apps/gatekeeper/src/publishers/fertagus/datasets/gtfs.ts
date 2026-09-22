import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_STATIC } from "../../../formats/gtfs/feeds";

export const DATASET: DatasetDefinition = {
  title: "Fertagus GTFS",
  description: "Stops, routes, agencies and service days, with route shapes, from Fertagus's current static schedule archive. Not live service or delay information.",
  licence: "source-terms",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
  feeds: [
    {
      slug: "fertagus-gtfs-feed",
      config: {
        source: "gtfs",
        url: "https://www.fertagus.pt/GTFSTMLzip/Fertagus_GTFS.zip",
        files: "agency,stops,routes,calendar,calendar_dates,shapes",
      },
      policy: DAILY_STATIC,
      staleAfterSeconds: 259_200,
    },
  ],
};
