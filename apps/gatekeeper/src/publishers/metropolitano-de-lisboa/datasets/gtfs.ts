import type { DatasetDefinition } from "#/catalog/define";
import { DAILY_STATIC } from "#/formats/gtfs/feeds";

export const DATASET: DatasetDefinition = {
  title: "Metropolitano de Lisboa GTFS",
  description: "Stations, lines, agencies, service calendars, and line shapes from Metropolitano de Lisboa's schedule archive.",
  licence: "source-terms",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
  feeds: [
    {
      slug: "metro-lisboa-gtfs-feed",
      // dados.gov.pt serves the latest upload of a resource at this address,
      // so a new archive replaces the old one without a config change.
      config: {
        source: "gtfs",
        url: "https://dados.gov.pt/api/1/datasets/r/e7e8ef72-9cee-43a0-b141-656ced144394",
        files: "agency,stops,routes,calendar,calendar_dates,shapes,feed_info",
      },
      policy: DAILY_STATIC,
      staleAfterSeconds: 259_200,
    },
  ],
};
