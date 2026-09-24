import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { METROLISBOA_DEPLOYMENT, METROLISBOA_NORMALIZER, METROLISBOA_TRANSFORMER, collectMetroFeed } from "#/publishers/metropolitano-de-lisboa/metrolisboa/index";

export const FEED = defineFeed(METROLISBOA_DEPLOYMENT, {
  slug: "metrolisboa-stations-feed",
  title: "Metro Lisboa stations",
  description: "Every Metro station with its position, lines, fare zone and page.",
  licence: "metrolisboa-api",
  attribution: "Metropolitano de Lisboa",
  topics: ["mobility"],
  config: { feed: "stations" },
  policy: {
    name: "Metro Lisboa reference data",
    version: 1,
    collection: { cadenceSeconds: 86_400, timeoutSeconds: 30, maxBytes: 256 * 1024, historyMode: "changes" },
  },
  staleAfterSeconds: 172_800,
  /** Once a day: every station, from the EstadoServicoML gateway with a fresh access token. */
  fetch: ({ config, validator, library, fetch }) => collectMetroFeed(config, validator, library.apiOrigin, library.credentials, fetch),
  /** The gateway's answers, as one collection document, into stations. */
  transform: { normalizer: METROLISBOA_NORMALIZER, buffered: (bytes, context) => runTransformer(METROLISBOA_TRANSFORMER, bytes, context) },
});
