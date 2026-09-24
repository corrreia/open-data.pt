import { defineFeed } from "#/catalog/define";
import { GTFS_DEPLOYMENT, GTFS_NORMALIZER, collectGtfsFeed, transformGtfs } from "#/formats/gtfs/index";
import { DAILY_STATIC } from "#/formats/gtfs/feeds";

export const FEED = defineFeed(GTFS_DEPLOYMENT, {
  slug: "tub-braga-gtfs-feed",
  title: "TUB Braga GTFS",
  description: "Stops, routes, agencies and service days, with route shapes, from TUB Braga's current static schedule archive. Not live service or delay information.",
  licence: "source-terms",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
  config: {
    url: "https://www.tub.pt/developer/gtfs/feed/tub.zip",
    files: "agency,stops,routes,calendar,calendar_dates,shapes",
  },
  policy: DAILY_STATIC,
  staleAfterSeconds: 259_200,
  /** Once a day: TUB Braga's GTFS archive, downloaded only when it changed. */
  fetch: ({ config, validator, library, fetch }) => collectGtfsFeed(config, validator, library.hosts, fetch),
  /** The archive, entry by entry as it streams, into stops, routes, agencies, service days and route shapes. */
  transform: { normalizer: GTFS_NORMALIZER, streaming: (body, context) => transformGtfs(body, context) },
});
