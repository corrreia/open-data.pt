import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { SNIRH_DEPLOYMENT, SNIRH_NORMALIZER, SNIRH_TRANSFORMER, collectSnirhFeed, collectSnirhHistory } from "#/publishers/apa/snirh/index";
import { SNIRH_MONTHLY_POLICY } from "#/publishers/apa/snirh/feeds";

export const FEED = defineFeed(SNIRH_DEPLOYMENT, {
  slug: "snirh-groundwater-state-feed",
  title: "Portugal groundwater state by aquifer",
  description:
    "Each month's groundwater class for the aquifers of SNIRH's groundwater bulletin: whether their wells stood above the monthly mean, between the mean and the 20th percentile, or below it.",
  licence: "snirh-terms",
  attribution: "SNIRH — Sistema Nacional de Informação de Recursos Hídricos, APA",
  topics: ["environment", "weather"],
  config: { feed: "groundwater-state" },
  policy: SNIRH_MONTHLY_POLICY,
  staleAfterSeconds: 259_200,
  /** Once a day: the latest bulletin SNIRH publishes, from the last one this feed saw. */
  fetch: ({ config, validator, library, fetch, now }) => collectSnirhFeed(config, validator, library.apiOrigin, fetch, now()),
  /** Once, walking back: one older slice of the same series at a time, until SNIRH has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => collectSnirhHistory(config, cursor, library.apiOrigin, fetch),
  /** SNIRH's export or bulletin, into one series per station or basin. */
  transform: { normalizer: SNIRH_NORMALIZER, buffered: (bytes, context) => runTransformer(SNIRH_TRANSFORMER, bytes, context) },
});
