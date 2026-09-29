import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { INFOAGUA_DEPLOYMENT, INFOAGUA_MAX_BYTES, INFOAGUA_NORMALIZER, INFOAGUA_TRANSFORMER, collectInfoaguaFeed } from "#/publishers/apa/infoagua/index";

export const FEED = defineFeed(INFOAGUA_DEPLOYMENT, {
  slug: "infoagua-reservoirs-feed",
  title: "Portugal reservoirs",
  description:
    "Each reservoir on APA InfoÁgua's drought pages, keyed by its SNIRH station code: its total and usable capacity in cubic hectometres, its full supply level in metres, what it serves (water supply, energy, industry, irrigation, environmental flow, flood control), and for each calendar month the lowest volume on record with its year. How full each one is now is in the SNIRH reservoir feeds.",
  licence: "source-terms",
  attribution: "InfoÁgua, Agência Portuguesa do Ambiente",
  topics: ["environment"],
  config: { feed: "reservoirs" },
  policy: { cadenceSeconds: 86_400, timeoutSeconds: 60, maxBytes: INFOAGUA_MAX_BYTES, historyMode: "changes" },
  staleAfterSeconds: 259_200,
  /** Once a day: InfoÁgua's drought search page, which carries every reservoir it shows inline. */
  fetch: ({ config, validator, library, fetch }) => collectInfoaguaFeed(config, validator, library.apiOrigin, fetch),
  /** The reservoirs the page carries, into one record per reservoir. */
  transform: { normalizer: INFOAGUA_NORMALIZER, buffered: (bytes, context) => runTransformer(INFOAGUA_TRANSFORMER, bytes, context) },
});
