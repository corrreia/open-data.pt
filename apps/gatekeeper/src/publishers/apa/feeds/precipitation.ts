import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { SNIRH_DEPLOYMENT, SNIRH_NORMALIZER, SNIRH_TRANSFORMER, collectSnirhHistory, collectSnirhLiveFromInfoagua } from "#/publishers/apa/snirh/index";
import { SNIRH_HOURLY_POLICY } from "#/publishers/apa/snirh/feeds";

export const FEED = defineFeed(SNIRH_DEPLOYMENT, {
  slug: "snirh-precipitation-feed",
  title: "Portugal hourly precipitation",
  description:
    "Hourly precipitation at SNIRH meteorological stations, in millimetres fallen in the hour ending at each time. Recent hours come from InfoÁgua, APA's public water app, which shows the rain gauges it watches for floods every 15 minutes within the hour; each hour is the sum of its four quarters, and an hour missing one is left out. Older readings come from SNIRH's station database.",
  licence: "snirh-terms",
  attribution: "SNIRH — Sistema Nacional de Informação de Recursos Hídricos, APA",
  topics: ["environment", "weather"],
  config: { feed: "readings", reading: "precipitation" },
  policy: SNIRH_HOURLY_POLICY,
  staleAfterSeconds: 172_800,
  /** Every three hours: the last day of 15-minute rain at every gauge InfoÁgua watches, summed into hours. */
  fetch: ({ config, validator, fetch }) => collectSnirhLiveFromInfoagua(config, validator, fetch),
  /** Once, walking back: one older slice of the same series at a time, until SNIRH has nothing older. */
  backfill: ({ config, library, fetch }, cursor) => collectSnirhHistory(config, cursor, library.apiOrigin, fetch),
  /** InfoÁgua's readings or SNIRH's export, into one series per station, keyed by its SNIRH code. */
  transform: { normalizer: SNIRH_NORMALIZER, buffered: (bytes, context) => runTransformer(SNIRH_TRANSFORMER, bytes, context) },
});
