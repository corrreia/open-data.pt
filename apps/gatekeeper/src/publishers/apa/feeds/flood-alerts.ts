import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { INFOAGUA_DEPLOYMENT, INFOAGUA_MAX_BYTES, INFOAGUA_NORMALIZER, INFOAGUA_TRANSFORMER, collectInfoaguaFeed } from "#/publishers/apa/infoagua/index";

export const FEED = defineFeed(INFOAGUA_DEPLOYMENT, {
  slug: "infoagua-flood-alerts-feed",
  title: "Portugal flood alerts by station",
  description:
    "The flood alert level APA's InfoÁgua shows for each river, rain and reservoir station it watches, kept as a history of every change. The readings behind the alerts are in the SNIRH feeds.",
  licence: "source-terms",
  attribution: "InfoÁgua, Agência Portuguesa do Ambiente",
  topics: ["environment", "weather"],
  config: { feed: "flood-alerts" },
  policy: {
    name: "InfoÁgua flood alerts",
    version: 1,
    // A station's alert follows its hourly reading; a quarter-hour cadence sees a change within the hour it happens.
    collection: { cadenceSeconds: 900, timeoutSeconds: 60, maxBytes: INFOAGUA_MAX_BYTES, historyMode: "changes" },
  },
  staleAfterSeconds: 3_600,
  /** Every quarter hour: InfoÁgua's flood search page, which carries the latest alert of every station it watches inline. */
  fetch: ({ config, validator, library, fetch }) => collectInfoaguaFeed(config, validator, library.apiOrigin, fetch),
  /** The stations the page carries, into one record per station and its alert level. */
  transform: { normalizer: INFOAGUA_NORMALIZER, buffered: (bytes, context) => runTransformer(INFOAGUA_TRANSFORMER, bytes, context) },
});
