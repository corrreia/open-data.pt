import type { DatasetDefinition } from "../../../catalog/define";
import { DAILY_STATIC } from "../../../formats/gtfs/feeds";

export const DATASET: DatasetDefinition = {
  title: "STCP GTFS",
  description: "Stops, routes, agencies, and service calendars from STCP's 1 September 2026 schedule archive.",
  licence: "source-terms",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
  feeds: [
    {
      slug: "stcp-gtfs-feed",
      // Porto's portal moved to dadosabertos.cm-porto.pt in September 2026 and every
      // dataset and resource ID changed with it; this is the newest STCP archive there.
      config: {
        source: "gtfs",
        url: "https://dadosabertos.cm-porto.pt/dataset/71490e40-9e19-11f1-84ed-6abdb6d5cf34/resource/51340c18-0ef5-4895-b099-cf7247ea54f4/download/gtfs_feed.zip",
      },
      policy: DAILY_STATIC,
      staleAfterSeconds: 259_200,
    },
  ],
};
