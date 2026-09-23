import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { CARRIS_DEPLOYMENT, CARRIS_NORMALIZER, CARRIS_TRANSFORMER, collectCarrisFeed } from "#/publishers/carris-metropolitana/carris/index";
import { CARRIS_REFERENCE_POLICY } from "#/publishers/carris-metropolitana/carris/feeds";

export const FEED = defineFeed(CARRIS_DEPLOYMENT, {
  slug: "carris-lines-feed",
  title: "Carris Metropolitana lines",
  description: "Slow-changing transit line reference data.",
  config: { feed: "lines" },
  policy: CARRIS_REFERENCE_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: Carris Metropolitana's /v2/lines endpoint, which answers with every line it runs. */
  fetch: ({ config, validator, library, fetch }) => collectCarrisFeed(config, validator, library.apiOrigin, fetch),
  /** The API's answer into the lines products. */
  transform: { normalizer: CARRIS_NORMALIZER, buffered: (bytes, context) => runTransformer(CARRIS_TRANSFORMER, bytes, context) },
});
