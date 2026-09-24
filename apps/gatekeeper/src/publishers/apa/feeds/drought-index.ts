import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { INFOAGUA_DEPLOYMENT, INFOAGUA_MAX_BYTES, INFOAGUA_NORMALIZER, INFOAGUA_TRANSFORMER, collectInfoaguaFeed } from "#/publishers/apa/infoagua/index";

export const FEED = defineFeed(INFOAGUA_DEPLOYMENT, {
  slug: "infoagua-drought-index-feed",
  title: "Portugal hydrological drought index by basin",
  description: "The monthly hydrological drought index and state of each river basin, as APA's InfoÁgua publishes it: wet, normal, or a hydrological drought of rising severity.",
  licence: "source-terms",
  attribution: "InfoÁgua, Agência Portuguesa do Ambiente",
  topics: ["environment", "weather"],
  config: { feed: "drought-index" },
  policy: {
    name: "InfoÁgua drought index",
    version: 1,
    collection: { cadenceSeconds: 86_400, timeoutSeconds: 60, maxBytes: INFOAGUA_MAX_BYTES, historyMode: "changes" },
  },
  staleAfterSeconds: 259_200,
  /** Once a day: InfoÁgua's drought page, which carries the latest month's index of every river basin inline. */
  fetch: ({ config, validator, library, fetch }) => collectInfoaguaFeed(config, validator, library.apiOrigin, fetch),
  /** The basins the page carries, into one record per basin and month. */
  transform: { normalizer: INFOAGUA_NORMALIZER, buffered: (bytes, context) => runTransformer(INFOAGUA_TRANSFORMER, bytes, context) },
});
