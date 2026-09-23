import { defineFeed } from "#/catalog/define";
import { GTFS_DEPLOYMENT, GTFS_NORMALIZER, collectGtfsFeed, transformGtfs } from "#/formats/gtfs/index";
import { DAILY_STATIC } from "#/formats/gtfs/feeds";

export const FEED = defineFeed(GTFS_DEPLOYMENT, {
  slug: "horarios-do-funchal-gtfs-feed",
  // HF publishes service days only in calendar_dates.txt, not calendar.txt.
  config: {
    url: "https://www.horariosdofunchal.pt/googletransit.zip",
    files: "agency,stops,routes,calendar_dates,shapes",
  },
  policy: DAILY_STATIC,
  staleAfterSeconds: 259_200,
  /** Once a day: Horários do Funchal's GTFS archive, downloaded only when it changed. */
  fetch: ({ config, validator, library, fetch }) => collectGtfsFeed(config, validator, library.hosts, fetch),
  /** The archive, entry by entry as it streams, into stops, routes, agencies, service days and route shapes. */
  transform: { normalizer: GTFS_NORMALIZER, streaming: (body, context) => transformGtfs(body, context) },
});
