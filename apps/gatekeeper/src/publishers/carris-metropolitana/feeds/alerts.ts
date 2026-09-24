import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { CARRIS_DEPLOYMENT, CARRIS_NORMALIZER, CARRIS_TRANSFORMER, collectCarrisFeed } from "#/publishers/carris-metropolitana/carris/index";

export const FEED = defineFeed(CARRIS_DEPLOYMENT, {
  slug: "carris-alerts-feed",
  title: "Carris Metropolitana service alerts",
  description: "Current service disruptions with correction history.",
  licence: "cc-by-4.0",
  attribution: "Carris Metropolitana",
  topics: ["mobility"],
  config: { feed: "alerts" },
  policy: {
    name: "Carris service alerts",
    version: 2,
    collection: {
      // Alerts are posted days before the disruption they announce; five-minute polling never saw one change.
      cadenceSeconds: 900,
      timeoutSeconds: 20,
      maxBytes: 2 * 1024 * 1024,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 900,
  /** Every fifteen minutes: Carris Metropolitana's /v2/alerts endpoint, which answers with every active service alert. */
  fetch: ({ config, validator, library, fetch }) => collectCarrisFeed(config, validator, library.apiOrigin, fetch),
  /** The API's answer into the alerts products. */
  transform: { normalizer: CARRIS_NORMALIZER, buffered: (bytes, context) => runTransformer(CARRIS_TRANSFORMER, bytes, context) },
});
