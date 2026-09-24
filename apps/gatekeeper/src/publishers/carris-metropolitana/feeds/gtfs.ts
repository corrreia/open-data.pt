import { defineFeed } from "#/catalog/define";
import { GTFS_DEPLOYMENT, GTFS_NORMALIZER, collectGtfsFeed, transformGtfs } from "#/formats/gtfs/index";
import { LICENSED_DAILY_STATIC } from "#/formats/gtfs/feeds";

export const FEED = defineFeed(GTFS_DEPLOYMENT, {
  slug: "carris-metropolitana-gtfs-feed",
  title: "Carris Metropolitana GTFS",
  description: "Stops, routes, agencies, and calendar exceptions from the current static schedule archive.",
  // Carris publishes service days only as calendar_dates.txt; asking for
  // calendar.txt would declare a product the archive never fills.
  licence: "cc-by-4.0",
  attribution: "Carris Metropolitana",
  topics: ["mobility"],
  config: {
    url: "https://api.carrismetropolitana.pt/v2/gtfs",
    files: "agency,stops,routes,calendar_dates,feed_info",
  },
  // The repository that distributes this archive carries a CC BY 4.0 LICENSE.
  policy: LICENSED_DAILY_STATIC,
  staleAfterSeconds: 259_200,
  /** Once a day: Carris Metropolitana's GTFS archive, downloaded only when it changed. */
  fetch: ({ config, validator, library, fetch }) => collectGtfsFeed(config, validator, library.hosts, fetch),
  /** The archive, entry by entry as it streams, into stops, routes, agencies, calendar exceptions and feed information. */
  transform: { normalizer: GTFS_NORMALIZER, streaming: (body, context) => transformGtfs(body, context) },
});
