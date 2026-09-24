import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { METROLISBOA_DEPLOYMENT, METROLISBOA_NORMALIZER, METROLISBOA_TRANSFORMER, collectMetroFeed } from "#/publishers/metropolitano-de-lisboa/metrolisboa/index";

export const FEED = defineFeed(METROLISBOA_DEPLOYMENT, {
  slug: "metrolisboa-line-status-feed",
  title: "Metro Lisboa line status",
  description: "Whether each of the four Metro lines runs normally, and the service message when it does not.",
  licence: "metrolisboa-api",
  attribution: "Metropolitano de Lisboa",
  topics: ["mobility"],
  config: { feed: "line-status" },
  policy: {
    name: "Metro Lisboa line status",
    version: 3,
    // Every change of a line's status is a disruption starting or ending: that is the history worth keeping.
    // A line's status changes about three times a day, so five minutes still catches a disruption while it matters.
    collection: { cadenceSeconds: 300, timeoutSeconds: 20, maxBytes: 64 * 1024, historyMode: "changes" },
  },
  staleAfterSeconds: 600,
  /** Every five minutes: the status of all four lines, from the EstadoServicoML gateway with a fresh access token. */
  fetch: ({ config, validator, library, fetch }) => collectMetroFeed(config, validator, library.apiOrigin, library.credentials, fetch),
  /** The gateway's answers, as one collection document, into line-status. */
  transform: { normalizer: METROLISBOA_NORMALIZER, buffered: (bytes, context) => runTransformer(METROLISBOA_TRANSFORMER, bytes, context) },
});
