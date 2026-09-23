import { defineFeed } from "#/catalog/define";
import { IPMA_DEPLOYMENT, IPMA_DATASET_NORMALIZER, IPMA_DATASET_TRANSFORMER, collectIpmaFeed } from "#/publishers/ipma/ipma/index";

export const FEED = defineFeed(IPMA_DEPLOYMENT, {
  slug: "ipma-municipal-temperature-feed",
  title: "IPMA daily municipal temperature",
  description:
    "Spatial municipal means of interpolated daily minimum, mean and maximum air temperature in mainland Portugal. Collects the full 20-day source window; the bounded current-series view can contain fewer days, with the full collected window retained in history after delivery. Other source statistics, including spatial dispersion and quantiles, are not republished.",
  config: { feed: "municipal-temperature" },
  policy: {
    name: "IPMA daily municipal climate",
    version: 2,
    collection: { cadenceSeconds: 86_400, timeoutSeconds: 120, maxBytes: 2 * 1024 * 1024, maxOutputBytes: 16 * 1024 * 1024, historyMode: "changes" },
  },
  staleAfterSeconds: 3 * 86_400,
  /** Once a day: IPMA's 20-day CSV of municipal temperature, re-read only when the file has changed. */
  fetch: ({ config, validator, library, fetch }) => collectIpmaFeed(config, validator, library.apiOrigin, fetch),
  /** The CSV, row by row, into one temperature series per municipality and measure. */
  transform: { normalizer: IPMA_DATASET_NORMALIZER, streaming: (body, context) => IPMA_DATASET_TRANSFORMER.transform(body, context) },
});
