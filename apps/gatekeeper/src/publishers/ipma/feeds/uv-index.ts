import { defineFeed } from "#/catalog/define";
import { IPMA_DEPLOYMENT, IPMA_NORMALIZER, IPMA_TRANSFORMER, collectIpmaFeed } from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-uv-index-feed",
  title: "IPMA UV index forecast",
  description: "Daily UV index forecasts by IPMA forecast location and period.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment", "weather"],
  config: { feed: "uv-index" },
  policy: {
    name: "IPMA UV forecast reference",
    version: 2,
    collection: {
      cadenceSeconds: 14_400,
      timeoutSeconds: 30,
      maxBytes: 128 * 1024,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 28_800,
  /** Every four hours: IPMA's UV index forecast, with the district table it refers to. */
  fetch: ({ config, validator, library, fetch }) => collectIpmaFeed(config, validator, library.apiOrigin, fetch),
  /** The forecast, into one record per place, day and period. */
  transform: { normalizer: IPMA_NORMALIZER, buffered: (bytes, context) => IPMA_TRANSFORMER.transform(bytes, context) },
});
