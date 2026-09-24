import type { PublisherDefinition } from "#/catalog/define";
import { FEED as portugueseDayAheadPrices } from "./feeds/portuguese-day-ahead-prices";
import { FEED as sevenDayDayAheadPrices } from "./feeds/seven-day-day-ahead-prices";

export const PUBLISHER: PublisherDefinition = {
  name: "OMIE · Iberian electricity market",
  url: "https://www.omie.es/",
  sources: ["www.omie.es"],
  logo: "png",
  feeds: [
    // One feed per file family: the seven-day window already holds every day a two-day Spanish feed would.
    portugueseDayAheadPrices,
    sevenDayDayAheadPrices,
  ],
};
