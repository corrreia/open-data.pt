import { defineFeed } from "#/catalog/define";
import { GTFS_DEPLOYMENT, GTFS_NORMALIZER, collectGtfsFeed, transformGtfs } from "#/formats/gtfs/index";
import { DAILY_STATIC } from "#/formats/gtfs/feeds";

export const FEED = defineFeed(GTFS_DEPLOYMENT, {
  slug: "metro-do-porto-gtfs-feed",
  // Read from Metro do Porto rather than from Porto's open-data portal: their two newest
  // uploads there are zero bytes, as they were on the old portal, leaving the portal's
  // newest readable archive the one from 7 April 2026. The file linked from
  // https://www.metrodoporto.pt/pages/337 is the September 2026 schedule.
  // The name carries its release date, so a new schedule needs this address changed;
  // the feed goes stale within three days if that is missed. The archive carries no
  // feed_info.txt, which the old configuration asked for and never received.
  title: "Metro do Porto GTFS",
  description: "Stops, routes, agencies, service calendars, and route shapes from Metro do Porto's own schedule archive.",
  licence: "source-terms",
  attribution: "Published by the named transit operator",
  topics: ["mobility"],
  config: {
    url: "https://www.metrodoporto.pt/metrodoporto/uploads/document/file/794/google_transit_04_09_2026.zip",
    files: "agency,stops,routes,calendar,calendar_dates,shapes",
  },
  policy: DAILY_STATIC,
  staleAfterSeconds: 259_200,
  /** Once a day: Metro do Porto's GTFS archive, downloaded only when it changed. */
  fetch: ({ config, validator, library, fetch }) => collectGtfsFeed(config, validator, library.hosts, fetch),
  /** The archive, entry by entry as it streams, into stops, routes, agencies, service calendars and route shapes. */
  transform: { normalizer: GTFS_NORMALIZER, streaming: (body, context) => transformGtfs(body, context) },
});
