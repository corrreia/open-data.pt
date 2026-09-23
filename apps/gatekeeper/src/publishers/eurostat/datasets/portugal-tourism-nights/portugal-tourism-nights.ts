import { defineFeed } from "#/catalog/define";
import { EUROSTAT_DEPLOYMENT, EUROSTAT_NORMALIZER, collectEurostatDataset, collectEurostatDatasetHistory, transformEurostatDataset } from "#/publishers/eurostat/eurostat/index";
import { DAILY_STATISTICS, DAY } from "#/publishers/eurostat/eurostat/feeds";

export const FEED = defineFeed(EUROSTAT_DEPLOYMENT, {
  slug: "eurostat-portugal-tourism-nights",
  config: { dataset: "tour_occ_nim", filters: "c_resid=TOTAL&freq=M&geo=PT&nace_r2=I551-I553&unit=NR", lastTimePeriod: "120", lang: "EN" },
  policy: DAILY_STATISTICS,
  staleAfterSeconds: 7 * DAY,
  /** Once a day: the last 120 months (10 years) of this Portugal series from Eurostat's statistics API. */
  fetch: ({ config, validator, library, fetch }) => collectEurostatDataset(config, validator, library.apiOrigin, fetch),
  /** Walking back: the periods before the cursor, up to 120 of them in one request. */
  backfill: ({ config, library, fetch }, cursor) => collectEurostatDatasetHistory(config, cursor, library.apiOrigin, fetch),
  /** Eurostat's JSON-stat dataset, into a series of the values by period. */
  transform: { normalizer: EUROSTAT_NORMALIZER, buffered: (bytes, context) => transformEurostatDataset(bytes, context) },
});
