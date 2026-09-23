import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { CARRIS_DEPLOYMENT, CARRIS_NORMALIZER, CARRIS_TRANSFORMER, collectCarrisFeed } from "#/publishers/carris-metropolitana/carris/index";

export const FEED = defineFeed(CARRIS_DEPLOYMENT, {
  slug: "carris-vehicles-feed",
  title: "Carris Metropolitana vehicle positions",
  description: "Near-real-time current vehicle state with minute summaries.",
  config: { feed: "vehicles" },
  policy: {
    name: "Carris realtime state",
    version: 4,
    collection: {
      cadenceSeconds: 60,
      timeoutSeconds: 20,
      maxBytes: 10 * 1024 * 1024,
      historyMode: "changes",
      // Positions move every minute: their revisions are noise, not history (about 1.1 million lake rows a day).
      // The fleet summary repeats the counts the active-vehicles series records. That series keeps every minute.
      withoutHistory: ["vehicles-current", "fleet-summary"],
    },
  },
  staleAfterSeconds: 180,
  /** Every minute: Carris Metropolitana's /v2/vehicles endpoint, which answers with where every vehicle is now. */
  fetch: ({ config, validator, library, fetch }) => collectCarrisFeed(config, validator, library.apiOrigin, fetch),
  /** The API's answer into the vehicles products. */
  transform: { normalizer: CARRIS_NORMALIZER, buffered: (bytes, context) => runTransformer(CARRIS_TRANSFORMER, bytes, context) },
});
