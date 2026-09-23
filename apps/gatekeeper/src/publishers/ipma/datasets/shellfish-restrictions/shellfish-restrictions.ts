import { defineFeed } from "#/catalog/define";
import { IPMA_DEPLOYMENT, IPMA_DATASET_NORMALIZER, IPMA_DATASET_TRANSFORMER, collectIpmaFeed } from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-shellfish-restrictions-feed",
  config: { feed: "shellfish-restrictions" },
  policy: {
    name: "IPMA shellfish bulletin",
    version: 2,
    collection: {
      cadenceSeconds: 21_600,
      timeoutSeconds: 90,
      maxBytes: 8 * 1024 * 1024,
      maxOutputBytes: 16 * 1024 * 1024,
      maxRecordBytes: 1024 * 1024,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 86_400,
  /** Every six hours: IPMA's shellfish bulletin, re-read only when the file has changed. */
  fetch: ({ config, validator, library, fetch }) => collectIpmaFeed(config, validator, library.apiOrigin, fetch),
  /** The bulletin's GeoJSON, zone by zone, into each production zone and what may be harvested there. */
  transform: { normalizer: IPMA_DATASET_NORMALIZER, streaming: (body, context) => IPMA_DATASET_TRANSFORMER.transform(body, context) },
});
