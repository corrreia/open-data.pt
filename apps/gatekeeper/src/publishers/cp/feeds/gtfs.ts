import { defineFeed } from "#/catalog/define";
import { GTFS_DEPLOYMENT, GTFS_NORMALIZER, collectGtfsFeed, transformGtfs } from "#/formats/gtfs/index";
import { DAILY_STATIC } from "#/formats/gtfs/feeds";

export const FEED = defineFeed(GTFS_DEPLOYMENT, {
  slug: "cp-gtfs-feed",
  title: "CP GTFS",
  description: "Stops, routes, agencies and service days from CP's current static schedule archive. Not live service or delay information.",
  licence: "source-terms",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
  config: {
    url: "https://publico.cp.pt/gtfs/gtfs.zip",
    files: "agency,stops,routes,calendar,calendar_dates",
  },
  policy: DAILY_STATIC,
  staleAfterSeconds: 259_200,
  /** Once a day: CP's GTFS archive, downloaded only when it changed. */
  fetch: ({ config, validator, library, fetch }) => collectGtfsFeed(config, validator, library.hosts, fetch),
  /** The archive, entry by entry as it streams, into stops, routes, agencies and service days. */
  transform: { normalizer: GTFS_NORMALIZER, streaming: (body, context) => transformGtfs(body, context) },
});
