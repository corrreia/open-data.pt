import { defineFeed } from "#/catalog/define";
import { IPMA_DEPLOYMENT, IPMA_NORMALIZER, IPMA_TRANSFORMER, collectIpmaFeed } from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-sea-forecast-feed",
  config: { feed: "sea-forecast" },
  policy: {
    name: "IPMA sea forecast reference",
    version: 3,
    collection: {
      cadenceSeconds: 3_600,
      timeoutSeconds: 30,
      maxBytes: 64 * 1024,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 7_200,
  /** Every hour: IPMA's three daily sea forecasts, with the coastal locations they refer to. */
  fetch: ({ config, validator, library, fetch }) => collectIpmaFeed(config, validator, library.apiOrigin, fetch),
  /** The forecasts, into one record per location and day. */
  transform: { normalizer: IPMA_NORMALIZER, buffered: (bytes, context) => IPMA_TRANSFORMER.transform(bytes, context) },
});
