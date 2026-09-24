import { defineFeed } from "#/catalog/define";
import { EUROSTAT_DEPLOYMENT, EUROSTAT_NORMALIZER, collectEurostatDataset, collectEurostatDatasetHistory, transformEurostatDataset } from "#/publishers/eurostat/eurostat/index";
import { DAILY_STATISTICS, DAY } from "#/publishers/eurostat/eurostat/feeds";

export const FEED = defineFeed(EUROSTAT_DEPLOYMENT, {
  slug: "eurostat-portugal-house-price-index",
  title: "Portugal quarterly house price index",
  description: "Quarterly index of all residential property purchases in Portugal, with 2015 equal to 100.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["economy"],
  config: { dataset: "prc_hpi_q", filters: "freq=Q&geo=PT&purchase=TOTAL&unit=I15_Q", lastTimePeriod: "80", lang: "EN" },
  policy: DAILY_STATISTICS,
  staleAfterSeconds: 7 * DAY,
  /** Once a day: the last 80 quarters (20 years) of this Portugal series from Eurostat's statistics API. */
  fetch: ({ config, validator, library, fetch }) => collectEurostatDataset(config, validator, library.apiOrigin, fetch),
  /** Walking back: the periods before the cursor, up to 120 of them in one request. */
  backfill: ({ config, library, fetch }, cursor) => collectEurostatDatasetHistory(config, cursor, library.apiOrigin, fetch),
  /** Eurostat's JSON-stat dataset, into a series of the values by period. */
  transform: { normalizer: EUROSTAT_NORMALIZER, buffered: (bytes, context) => transformEurostatDataset(bytes, context) },
});
