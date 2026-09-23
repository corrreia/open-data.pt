import { defineFeed } from "#/catalog/define";
import { GTFS_DEPLOYMENT, GTFS_NORMALIZER, collectGtfsFeed, transformGtfs } from "#/formats/gtfs/index";
import { DAILY_STATIC } from "#/formats/gtfs/feeds";

export const FEED = defineFeed(GTFS_DEPLOYMENT, {
  slug: "metro-lisboa-gtfs-feed",
  // dados.gov.pt serves the latest upload of a resource at this address,
  // so a new archive replaces the old one without a config change.
  config: {
    url: "https://dados.gov.pt/api/1/datasets/r/e7e8ef72-9cee-43a0-b141-656ced144394",
    files: "agency,stops,routes,calendar,calendar_dates,shapes,feed_info",
  },
  policy: DAILY_STATIC,
  staleAfterSeconds: 259_200,
  /** Once a day: Metropolitano de Lisboa's GTFS archive, downloaded only when it changed. */
  fetch: ({ config, validator, library, fetch }) => collectGtfsFeed(config, validator, library.hosts, fetch),
  /** The archive, entry by entry as it streams, into stations, lines, agencies, service calendars, line shapes and feed information. */
  transform: { normalizer: GTFS_NORMALIZER, streaming: (body, context) => transformGtfs(body, context) },
});
