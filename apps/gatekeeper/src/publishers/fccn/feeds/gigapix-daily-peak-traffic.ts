import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { PICASSO_DEPLOYMENT, PICASSO_NORMALIZER, PICASSO_TRANSFORMER, collectPicassoFeed } from "#/publishers/fccn/picasso/index";
import { PICASSO_COLLECTION } from "#/publishers/fccn/picasso/feeds";

export const FEED = defineFeed(PICASSO_DEPLOYMENT, {
  slug: "fccn-gigapix-daily-peak-traffic-feed",
  title: "GigaPIX daily peak traffic",
  description:
    "The highest traffic rate through GigaPIX, the Portuguese internet exchange point FCCN runs, in each UTC day, in bits per second, as the yearly chart of FCCN's traffic statistics draws it. A day is published once it has ended, so its value is final; the first collection brings the last year. FCCN does not say whether the total counts traffic in one direction or both, nor over what interval the peak is taken: it stands well above the highest of the day's five-minute means.",
  // FCT states no licence for the statistics, only "todos os direitos reservados" in the site's footer; what a public
  // institute publishes may be reused unless it states otherwise (Lei 26/2016, art. 21.º).
  licence: "source-terms",
  attribution: "FCT | FCCN, GigaPIX traffic statistics",
  topics: ["telecom"],
  config: { mode: "yearly" },
  // One request of about 16 KB a day: a day ends once a day.
  policy: { ...PICASSO_COLLECTION, cadenceSeconds: 86_400 },
  staleAfterSeconds: 172_800,
  /** Once a day: the yearly chart, 366 days ending with today. */
  fetch: ({ config, library, fetch }) => collectPicassoFeed(config, library.apiOrigin, fetch),
  /** Each ended day's maximum, into one series; today, still under way, is left for tomorrow. */
  transform: { normalizer: PICASSO_NORMALIZER, buffered: (bytes, context) => runTransformer(PICASSO_TRANSFORMER, bytes, context) },
});
