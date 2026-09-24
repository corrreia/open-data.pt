import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { SNIRH_DEPLOYMENT, SNIRH_NORMALIZER, SNIRH_TRANSFORMER, collectSnirhFeed, collectSnirhHistory } from "#/publishers/apa/snirh/index";
import { SNIRH_DAILY_POLICY } from "#/publishers/apa/snirh/feeds";

export const FEED = defineFeed(SNIRH_DEPLOYMENT, {
  slug: "snirh-river-flows-feed",
  title: "Portugal river flows",
  description: "Mean daily flow at SNIRH hydrometric stations. Readings come from SNIRH's station database, usually within a day of being taken.",
  licence: "snirh-terms",
  attribution: "SNIRH — Sistema Nacional de Informação de Recursos Hídricos, APA",
  topics: ["environment", "weather"],
  config: { feed: "readings", reading: "river-flow" },
  policy: SNIRH_DAILY_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: the river flow readings SNIRH's station database exports, from the last one this feed saw. */
  fetch: ({ config, validator, library, fetch, now }) => collectSnirhFeed(config, validator, library.apiOrigin, fetch, now()),
  /** Once, walking back: one older slice of the same series at a time, until SNIRH has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => collectSnirhHistory(config, cursor, library.apiOrigin, fetch),
  /** SNIRH's export or bulletin, into one series per station or basin. */
  transform: { normalizer: SNIRH_NORMALIZER, buffered: (bytes, context) => runTransformer(SNIRH_TRANSFORMER, bytes, context) },
});
