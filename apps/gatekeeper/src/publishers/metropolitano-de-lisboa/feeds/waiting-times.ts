import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { METROLISBOA_DEPLOYMENT, METROLISBOA_NORMALIZER, METROLISBOA_TRANSFORMER, collectMetroFeed } from "#/publishers/metropolitano-de-lisboa/metrolisboa/index";

export const FEED = defineFeed(METROLISBOA_DEPLOYMENT, {
  slug: "metrolisboa-waiting-times-feed",
  title: "Metro Lisboa waiting times",
  description: "The next three trains at every platform of the network, in seconds, with their destination.",
  licence: "metrolisboa-api",
  attribution: "Metropolitano de Lisboa",
  topics: ["mobility"],
  config: { feed: "waiting-times" },
  policy: {
    name: "Metro Lisboa waiting times",
    version: 2,
    // Next-train times are a live reading that is out of date a minute later, not history.
    collection: { cadenceSeconds: 60, timeoutSeconds: 20, maxBytes: 512 * 1024, historyMode: "latest" },
  },
  staleAfterSeconds: 180,
  /** Every minute: the next trains at every platform, from the EstadoServicoML gateway with a fresh access token; none while the network is closed. */
  fetch: ({ config, validator, library, fetch, now }) => collectMetroFeed(config, validator, library.apiOrigin, library.credentials, fetch, now()),
  /** The gateway's answers, as one collection document, into waiting-times. */
  transform: { normalizer: METROLISBOA_NORMALIZER, buffered: (bytes, context) => runTransformer(METROLISBOA_TRANSFORMER, bytes, context) },
});
