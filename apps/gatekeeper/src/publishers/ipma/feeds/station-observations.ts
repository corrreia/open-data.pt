import { defineFeed } from "#/catalog/define";
import { IPMA_DEPLOYMENT, IPMA_NORMALIZER, IPMA_TRANSFORMER, collectIpmaFeed } from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-station-observations-feed",
  title: "IPMA hourly station observations",
  description: "The last 24 hours of temperature, humidity, wind, precipitation, and pressure readings from IPMA stations.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
  config: { feed: "station-observations" },
  policy: {
    name: "IPMA hourly observations",
    version: 5,
    collection: {
      cadenceSeconds: 3_600,
      timeoutSeconds: 30,
      maxBytes: 3 * 1024 * 1024,
      historyMode: "changes",
      // The latest reading per station repeats values the observations series already records.
      withoutHistory: ["stations-latest"],
    },
  },
  staleAfterSeconds: 7_200,
  /** Every hour: the last 24 hours of IPMA station observations, with the station list. */
  fetch: ({ config, validator, library, fetch }) => collectIpmaFeed(config, validator, library.apiOrigin, fetch),
  /** The observations, into hourly series per station and each station's latest reading. */
  transform: { normalizer: IPMA_NORMALIZER, buffered: (bytes, context) => IPMA_TRANSFORMER.transform(bytes, context) },
});
