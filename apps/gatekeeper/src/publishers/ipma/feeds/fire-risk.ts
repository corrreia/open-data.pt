import { defineFeed } from "#/catalog/define";
import { IPMA_DEPLOYMENT, IPMA_NORMALIZER, IPMA_TRANSFORMER, collectIpmaFeed } from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-fire-risk-feed",
  title: "IPMA municipal fire risk",
  description: "The rural fire danger IPMA forecasts for each municipality of mainland Portugal, by its code, for today and the two days after.",
  licence: "ipma-terms",
  attribution: "Instituto Português do Mar e da Atmosfera (IPMA)",
  topics: ["environment"],
  config: { feed: "fire-risk" },
  policy: {
    cadenceSeconds: 14_400,
    timeoutSeconds: 30,
    maxBytes: 128 * 1024,
    historyMode: "latest",
  },
  staleAfterSeconds: 28_800,
  /** Every four hours: IPMA's three daily fire-risk forecasts, with the district table they refer to. */
  fetch: ({ config, validator, library, fetch }) => collectIpmaFeed(config, validator, library.apiOrigin, fetch),
  /** The forecasts, into the current risk class per municipality and day. */
  transform: { normalizer: IPMA_NORMALIZER, buffered: (bytes, context) => IPMA_TRANSFORMER.transform(bytes, context) },
});
