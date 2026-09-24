import { defineFeed } from "#/catalog/define";
import { IPMA_DEPLOYMENT, IPMA_NORMALIZER, IPMA_TRANSFORMER, collectIpmaFeed } from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-daily-forecast-feed",
  title: "IPMA three-day city forecast",
  description: "Daily weather forecasts for Portuguese district capitals and islands for today and the following two days.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
  config: { feed: "daily-forecast" },
  policy: {
    name: "IPMA forecast reference",
    version: 3,
    collection: {
      cadenceSeconds: 3_600,
      timeoutSeconds: 30,
      maxBytes: 2 * 1024 * 1024,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 3_600,
  /** Every hour: IPMA's three daily city forecasts, with the district and weather-type tables they refer to. */
  fetch: ({ config, validator, library, fetch }) => collectIpmaFeed(config, validator, library.apiOrigin, fetch),
  /** The forecasts, into one record per place and day. */
  transform: { normalizer: IPMA_NORMALIZER, buffered: (bytes, context) => IPMA_TRANSFORMER.transform(bytes, context) },
});
