import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { CARRIS_DEPLOYMENT, CARRIS_NORMALIZER, CARRIS_TRANSFORMER, collectCarrisFeed } from "#/publishers/carris-metropolitana/carris/index";
import { CARRIS_REFERENCE_POLICY } from "#/publishers/carris-metropolitana/carris/feeds";

export const FEED = defineFeed(CARRIS_DEPLOYMENT, {
  slug: "carris-routes-feed",
  title: "Carris Metropolitana routes",
  description: "Route variants of each line, with colours and served municipalities.",
  licence: "cc-by-4.0",
  attribution: "Carris Metropolitana",
  topics: ["mobility"],
  config: { feed: "routes" },
  policy: CARRIS_REFERENCE_POLICY,
  staleAfterSeconds: 172_800,
  /** Once a day: Carris Metropolitana's /v2/routes endpoint, which answers with every route variant of every line. */
  fetch: ({ config, validator, library, fetch }) => collectCarrisFeed(config, validator, library.apiOrigin, fetch),
  /** The API's answer into the routes products. */
  transform: { normalizer: CARRIS_NORMALIZER, buffered: (bytes, context) => runTransformer(CARRIS_TRANSFORMER, bytes, context) },
});
