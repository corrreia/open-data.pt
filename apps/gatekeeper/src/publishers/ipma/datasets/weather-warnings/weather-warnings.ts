import { defineFeed } from "#/catalog/define";
import { IPMA_DEPLOYMENT, IPMA_NORMALIZER, IPMA_TRANSFORMER, collectIpmaFeed } from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-weather-warnings-feed",
  config: { feed: "warnings" },
  policy: {
    name: "IPMA warning changes",
    version: 3,
    collection: {
      cadenceSeconds: 1_800,
      timeoutSeconds: 30,
      maxBytes: 128 * 1024,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 3_600,
  /** Every half hour: IPMA's current weather warnings, with the district table they refer to. */
  fetch: ({ config, validator, library, fetch }) => collectIpmaFeed(config, validator, library.apiOrigin, fetch),
  /** The warnings, into one record per area, type and period. */
  transform: { normalizer: IPMA_NORMALIZER, buffered: (bytes, context) => IPMA_TRANSFORMER.transform(bytes, context) },
});
