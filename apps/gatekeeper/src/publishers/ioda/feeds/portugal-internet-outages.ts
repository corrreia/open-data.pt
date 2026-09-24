import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { IODA_DEPLOYMENT, IODA_NORMALIZER, IODA_TRANSFORMER, collectIodaFeed } from "#/publishers/ioda/ioda/index";
import { IODA_OUTAGE_POLICY } from "#/publishers/ioda/ioda/feeds";

export const FEED = defineFeed(IODA_DEPLOYMENT, {
  slug: "ioda-portugal-internet-outages-feed",
  title: "Internet outages detected in Portugal",
  description:
    "Every internet outage IODA detected for Portugal in the past week: when it started, how long it lasted, which measurement source and detection method saw it, and how far the country fell below its own normal. Academic detection from BGP, active probing, network telescope and Google traffic, not an operator's incident report, and an outage no measurement source saw is not in it.",
  licence: "ioda-all-rights-reserved",
  attribution: "IODA, Internet Intelligence Lab, Georgia Institute of Technology",
  topics: ["telecom"],
  config: { feed: "outage-events", entityType: "country", entityCode: "PT", days: "7" },
  policy: IODA_OUTAGE_POLICY,
  staleAfterSeconds: 2700,
  /** Every quarter hour: the outage events IODA detected for Portugal over the past seven days. */
  fetch: ({ config, library, fetch, now }) => collectIodaFeed(config, library.hosts, fetch, { kind: "live" }, now()),
  /** The events, into one record per outage. */
  transform: { normalizer: IODA_NORMALIZER, buffered: (bytes, context) => runTransformer(IODA_TRANSFORMER, bytes, context) },
});
