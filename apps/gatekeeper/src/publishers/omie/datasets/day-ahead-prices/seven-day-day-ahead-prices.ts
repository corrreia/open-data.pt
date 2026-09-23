import { defineFeed } from "#/catalog/define";
import { OMIE_DEPLOYMENT, OMIE_NORMALIZER, OMIE_TRANSFORMER, collectOmieFeed, collectOmieHistory } from "#/publishers/omie/omie/index";
import { OMIE_DAY_AHEAD_POLICY } from "#/publishers/omie/omie/feeds";

export const FEED = defineFeed(OMIE_DEPLOYMENT, {
  slug: "omie-seven-day-day-ahead-prices-feed",
  title: "OMIE seven-day day-ahead price window",
  description: "The latest seven available day-ahead price files from OMIE's Spanish file family.",
  config: { series: "marginalpdbc", days: "7" },
  policy: OMIE_DAY_AHEAD_POLICY,
  staleAfterSeconds: 172_800,
  /** Every three hours: the latest seven day-ahead price files of OMIE's Spanish family. */
  fetch: ({ config, validator, library, fetch }) => collectOmieFeed(config, validator, library.apiOrigin, fetch),
  /** Walking back: the market days before the cursor, from OMIE's per-day public reports, a slice at a time. */
  backfill: ({ config, library, fetch }, cursor) => collectOmieHistory(config, cursor, library.apiOrigin, fetch),
  /** OMIE's price files, into the day-ahead price series. */
  transform: { normalizer: OMIE_NORMALIZER, buffered: (bytes, context) => OMIE_TRANSFORMER.transform(bytes, context) },
});
