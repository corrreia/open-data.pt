import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { INFOAGUA_DEPLOYMENT, INFOAGUA_MAX_BYTES, INFOAGUA_NORMALIZER, INFOAGUA_TRANSFORMER, collectInfoaguaFeed } from "#/publishers/apa/infoagua/index";

export const FEED = defineFeed(INFOAGUA_DEPLOYMENT, {
  slug: "infoagua-reservoir-flows-feed",
  title: "Portugal reservoir inflows and outflows",
  description:
    "The hourly flow into and out of each reservoir APA's InfoÁgua watches for floods, in cubic metres per second, under each reservoir's SNIRH station code: two series, inflows and outflows. InfoÁgua shows the last 48 hours, so the history starts with our first collection.",
  licence: "source-terms",
  attribution: "InfoÁgua, Agência Portuguesa do Ambiente",
  topics: ["environment", "weather"],
  config: { feed: "reservoir-flows" },
  // Reservoirs move slowly and InfoÁgua keeps 48 hours: every three hours, about sixty pages at one a second.
  policy: { cadenceSeconds: 10_800, timeoutSeconds: 600, maxBytes: INFOAGUA_MAX_BYTES, historyMode: "changes" },
  staleAfterSeconds: 32_400,
  /** Every three hours: InfoÁgua's list of watched stations, then each reservoir's page. */
  fetch: ({ config, validator, library, fetch }) => collectInfoaguaFeed(config, validator, library.apiOrigin, fetch),
  /** Each reservoir's hourly inflow and outflow, into two series keyed by SNIRH station code. */
  transform: { normalizer: INFOAGUA_NORMALIZER, buffered: (bytes, context) => runTransformer(INFOAGUA_TRANSFORMER, bytes, context) },
});
