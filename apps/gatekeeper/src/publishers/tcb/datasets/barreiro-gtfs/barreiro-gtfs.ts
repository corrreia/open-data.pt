import { defineFeed } from "#/catalog/define";
import { GTFS_DEPLOYMENT, GTFS_NORMALIZER, collectGtfsFeed, transformGtfs } from "#/formats/gtfs/index";
import { LICENSED_DAILY_STATIC } from "#/formats/gtfs/feeds";

export const FEED = defineFeed(GTFS_DEPLOYMENT, {
  slug: "tcb-barreiro-gtfs-feed",
  // TCB's own open-data page names the licence: "A licença Creative Commons
  // Attribution 4.0 – CC BY 4.0 estabelece as condições de utilização."
  config: {
    url: "https://backend.tcbarreiro.pt/download-gtfs",
    files: "agency,stops,routes,calendar,calendar_dates,shapes",
  },
  policy: LICENSED_DAILY_STATIC,
  staleAfterSeconds: 259_200,
  /** Once a day: Transportes Colectivos do Barreiro's GTFS archive, downloaded only when it changed. */
  fetch: ({ config, validator, library, fetch }) => collectGtfsFeed(config, validator, library.hosts, fetch),
  /** The archive, entry by entry as it streams, into stops, routes, agencies, service days and route shapes. */
  transform: { normalizer: GTFS_NORMALIZER, streaming: (body, context) => transformGtfs(body, context) },
});
