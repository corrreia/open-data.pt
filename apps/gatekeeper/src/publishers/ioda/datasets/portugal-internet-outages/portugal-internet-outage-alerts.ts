import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { IODA_DEPLOYMENT, IODA_NORMALIZER, IODA_TRANSFORMER, collectIodaFeed } from "#/publishers/ioda/ioda/index";
import { IODA_OUTAGE_POLICY } from "#/publishers/ioda/ioda/feeds";

export const FEED = defineFeed(IODA_DEPLOYMENT, {
  slug: "ioda-portugal-internet-outage-alerts-feed",
  title: "Internet outage alert levels for Portugal",
  description:
    "The per-bin alerts behind IODA's Portuguese outage events: the level each datasource crossed, the condition it crossed, the value measured and the historical value it was compared against. More granular and noisier than the outage log, and a 'normal' record is the end of an alert, not a new incident.",
  config: { feed: "outage-alerts", entityType: "country", entityCode: "PT", days: "7" },
  policy: IODA_OUTAGE_POLICY,
  staleAfterSeconds: 2700,
  /** Every quarter hour: the per-bin outage alerts IODA raised for Portugal over the past seven days. */
  fetch: ({ config, library, fetch, now }) => collectIodaFeed(config, library.hosts, fetch, { kind: "live" }, now()),
  /** The alerts, into one record per datasource, bin and level. */
  transform: { normalizer: IODA_NORMALIZER, buffered: (bytes, context) => runTransformer(IODA_TRANSFORMER, bytes, context) },
});
