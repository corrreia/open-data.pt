import { defineFeed } from "#/catalog/define";
import { EUROSTAT_DEPLOYMENT, EUROSTAT_NORMALIZER, collectEurostatDataset, collectEurostatDatasetHistory, transformEurostatDataset } from "#/publishers/eurostat/eurostat/index";
import { DAILY_STATISTICS, DAY } from "#/publishers/eurostat/eurostat/feeds";

export const FEED = defineFeed(EUROSTAT_DEPLOYMENT, {
  slug: "eurostat-portugal-economic-sentiment",
  // The dataset has no unit dimension, so the feed states its unit, as Eurostat documents it.
  title: "Portugal economic sentiment indicator",
  description: "Seasonally adjusted monthly economic sentiment indicator for Portugal.",
  licence: "eurostat",
  attribution: "Eurostat",
  topics: ["economy"],
  config: { dataset: "ei_bssi_m_r2", filters: "freq=M&geo=PT&indic=BS-ESI-I&s_adj=SA", lastTimePeriod: "120", lang: "EN", unit: "Index, long-term average = 100" },
  policy: DAILY_STATISTICS,
  staleAfterSeconds: 7 * DAY,
  /** Once a day: the last 120 months (10 years) of this Portugal series from Eurostat's statistics API. */
  fetch: ({ config, validator, library, fetch }) => collectEurostatDataset(config, validator, library.apiOrigin, fetch),
  /** Walking back: the periods before the cursor, up to 120 of them in one request. */
  backfill: ({ config, library, fetch }, cursor) => collectEurostatDatasetHistory(config, cursor, library.apiOrigin, fetch),
  /** Eurostat's JSON-stat dataset, into a series of the values by period. */
  transform: { normalizer: EUROSTAT_NORMALIZER, buffered: (bytes, context) => transformEurostatDataset(bytes, context) },
});
