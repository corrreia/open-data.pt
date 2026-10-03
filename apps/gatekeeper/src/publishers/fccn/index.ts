import type { PublisherDefinition } from "#/catalog/define";
import { FEED as gigapixDailyPeakTraffic } from "./feeds/gigapix-daily-peak-traffic";
import { FEED as gigapixTraffic } from "./feeds/gigapix-traffic";

export const PUBLISHER: PublisherDefinition = {
  name: "FCT | FCCN",
  url: "https://www.fccn.pt/",
  sources: [
    // Picasso, FCCN's network statistics, which the GigaPIX charts read. A handful of requests a day, kept apart so
    // the two feeds never ask at once.
    { host: "picasso.netop.fccn.pt", minIntervalSeconds: 5 },
  ],
  logo: "svg",
  feeds: [gigapixDailyPeakTraffic, gigapixTraffic],
};
