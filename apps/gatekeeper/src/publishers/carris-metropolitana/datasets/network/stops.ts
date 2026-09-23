import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { CARRIS_DEPLOYMENT, CARRIS_NORMALIZER, CARRIS_TRANSFORMER, collectCarrisFeed } from "#/publishers/carris-metropolitana/carris/index";
import { CARRIS_REFERENCE_POLICY } from "#/publishers/carris-metropolitana/carris/feeds";

export const FEED = defineFeed(CARRIS_DEPLOYMENT, {
  slug: "carris-stops-feed",
  title: "Carris Metropolitana stops",
  description: "Every stop in the network with its location and served lines.",
  config: { feed: "stops" },
  // About 13,000 stops in a 6.8 MB response, close to the 16 MiB default output cap.
  policy: {
    ...CARRIS_REFERENCE_POLICY,
    collection: { ...CARRIS_REFERENCE_POLICY.collection, maxOutputBytes: 64 * 1024 * 1024 },
  },
  staleAfterSeconds: 172_800,
  /** Once a day: Carris Metropolitana's /v2/stops endpoint, which answers with every stop in the network. */
  fetch: ({ config, validator, library, fetch }) => collectCarrisFeed(config, validator, library.apiOrigin, fetch),
  /** The API's answer into the stops products. */
  transform: { normalizer: CARRIS_NORMALIZER, buffered: (bytes, context) => runTransformer(CARRIS_TRANSFORMER, bytes, context) },
});
