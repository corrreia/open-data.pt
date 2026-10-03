import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { PICASSO_DEPLOYMENT, PICASSO_NORMALIZER, PICASSO_TRANSFORMER, collectPicassoFeed } from "#/publishers/fccn/picasso/index";
import { PICASSO_COLLECTION } from "#/publishers/fccn/picasso/feeds";

export const FEED = defineFeed(PICASSO_DEPLOYMENT, {
  slug: "fccn-gigapix-traffic-feed",
  title: "GigaPIX traffic every five minutes",
  description:
    "The traffic through GigaPIX, the Portuguese internet exchange point FCCN runs, as a mean in bits per second over each five minutes, dated by the start of the five minutes in UTC, as the daily chart of FCCN's traffic statistics draws it. The five minutes still under way are left for the next collection. FCCN does not say whether the total counts traffic in one direction or both. The history starts with our first collection.",
  // FCT states no licence for the statistics, only "todos os direitos reservados" in the site's footer; what a public
  // institute publishes may be reused unless it states otherwise (Lei 26/2016, art. 21.º).
  licence: "source-terms",
  attribution: "FCT | FCCN, GigaPIX traffic statistics",
  topics: ["telecom"],
  config: { mode: "daily" },
  // Each answer is the last 24 hours, about 13 KB: four a day overlap by 18 hours, so no five minutes are missed.
  policy: { ...PICASSO_COLLECTION, cadenceSeconds: 21_600 },
  staleAfterSeconds: 43_200,
  /** Every six hours: the daily chart, the last 24 hours in five-minute means. */
  fetch: ({ config, library, fetch }) => collectPicassoFeed(config, library.apiOrigin, fetch),
  /** Each ended five minutes, into one series. */
  transform: { normalizer: PICASSO_NORMALIZER, buffered: (bytes, context) => runTransformer(PICASSO_TRANSFORMER, bytes, context) },
});
