import { defineFeed } from "#/catalog/define";
import { IPMA_DEPLOYMENT, IPMA_NORMALIZER, IPMA_TRANSFORMER, collectIpmaFeed } from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-seismic-feed",
  title: "IPMA seismic events",
  description: "The latest 30-day seismic event lists for mainland Portugal, Madeira, and the Azores.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment"],
  config: { feed: "seismic" },
  policy: {
    name: "IPMA seismic changes",
    version: 3,
    collection: {
      cadenceSeconds: 3_600,
      timeoutSeconds: 30,
      maxBytes: 2 * 1024 * 1024,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 7_200,
  /** Every hour: IPMA's two 30-day seismic event lists. */
  fetch: ({ config, validator, library, fetch }) => collectIpmaFeed(config, validator, library.apiOrigin, fetch),
  /** The lists, into one record per seismic event. */
  transform: { normalizer: IPMA_NORMALIZER, buffered: (bytes, context) => IPMA_TRANSFORMER.transform(bytes, context) },
});
