import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { SNIRH_DEPLOYMENT, SNIRH_NORMALIZER, SNIRH_TRANSFORMER, collectSnirhHistory, collectSnirhLiveFromInfoagua } from "#/publishers/apa/snirh/index";
import { SNIRH_HOURLY_POLICY } from "#/publishers/apa/snirh/feeds";

export const FEED = defineFeed(SNIRH_DEPLOYMENT, {
  slug: "snirh-river-levels-feed",
  title: "Portugal river levels",
  description:
    "Instantaneous water level at SNIRH hydrometric stations, in metres above each station's gauge zero. Recent hours come from InfoÁgua, APA's public water app, which shows the hourly level of the river stations it watches for floods within the hour; it shows a level below the gauge zero as 0, and at a few stations it differs from the station database. Older readings come from SNIRH's station database: hourly, and every 5 to 15 minutes at some stations or in a flood.",
  licence: "snirh-terms",
  attribution: "SNIRH — Sistema Nacional de Informação de Recursos Hídricos, APA",
  topics: ["environment", "weather"],
  config: { feed: "readings", reading: "river-level" },
  policy: SNIRH_HOURLY_POLICY,
  staleAfterSeconds: 172_800,
  /** Every three hours: the last two days of hourly levels at every river station InfoÁgua watches. */
  fetch: ({ config, validator, fetch }) => collectSnirhLiveFromInfoagua(config, validator, fetch),
  /** Once, walking back: one older slice of the same series at a time, until SNIRH has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => collectSnirhHistory(config, cursor, library.apiOrigin, fetch),
  /** InfoÁgua's readings or SNIRH's export, into one series per station, keyed by its SNIRH code. */
  transform: { normalizer: SNIRH_NORMALIZER, buffered: (bytes, context) => runTransformer(SNIRH_TRANSFORMER, bytes, context) },
});
