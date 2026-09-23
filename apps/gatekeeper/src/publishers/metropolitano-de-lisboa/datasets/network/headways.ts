import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { METROLISBOA_DEPLOYMENT, METROLISBOA_NORMALIZER, METROLISBOA_TRANSFORMER, collectMetroFeed } from "#/publishers/metropolitano-de-lisboa/metrolisboa/index";

export const FEED = defineFeed(METROLISBOA_DEPLOYMENT, {
  slug: "metrolisboa-headways-feed",
  title: "Metro Lisboa scheduled headways",
  description: "The scheduled interval between trains on each line, by time of day, for weekdays and for weekends and holidays.",
  config: { feed: "headways" },
  policy: {
    name: "Metro Lisboa timetable",
    version: 1,
    collection: { cadenceSeconds: 86_400, timeoutSeconds: 60, maxBytes: 256 * 1024, historyMode: "changes" },
  },
  staleAfterSeconds: 172_800,
  /** Once a day: each line's scheduled headways for weekdays and for weekends, from the EstadoServicoML gateway with a fresh access token. */
  fetch: ({ config, validator, library, fetch }) => collectMetroFeed(config, validator, library.apiOrigin, library.credentials, fetch),
  /** The gateway's answers, as one collection document, into headways. */
  transform: { normalizer: METROLISBOA_NORMALIZER, buffered: (bytes, context) => runTransformer(METROLISBOA_TRANSFORMER, bytes, context) },
});
