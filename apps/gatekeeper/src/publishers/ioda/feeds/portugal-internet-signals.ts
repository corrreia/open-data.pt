import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { IODA_DEPLOYMENT, IODA_NORMALIZER, IODA_TRANSFORMER, collectIodaFeed } from "#/publishers/ioda/ioda/index";
import { IODA_SIGNAL_POLICY } from "#/publishers/ioda/ioda/feeds";

export const FEED = defineFeed(IODA_DEPLOYMENT, {
  slug: "ioda-portugal-internet-signals-feed",
  title: "Portugal internet connectivity signals",
  description:
    "IODA's country-wide connectivity measurements for Portugal: /24 blocks visible in BGP, /24 blocks answering active probes, unique source IPs reaching the Merit network telescope, and normalized Google traffic. Country totals, which are not the sum of the per-network feeds and cover networks those five do not. Not a speed, quality or customer-availability report.",
  licence: "ioda-all-rights-reserved",
  attribution: "IODA, Internet Intelligence Lab, Georgia Institute of Technology",
  topics: ["telecom"],
  config: { feed: "signals", entityType: "country", entityCode: "PT", hours: "3" },
  policy: IODA_SIGNAL_POLICY,
  staleAfterSeconds: 10_800,
  /** Every hour: IODA's raw country-wide connectivity signals for Portugal over the past three hours. */
  fetch: ({ config, library, fetch, now }) => collectIodaFeed(config, library.hosts, fetch, { kind: "live" }, now()),
  /** The signals, into one series per datasource, leaving a measurement gap out rather than publishing a zero. */
  transform: { normalizer: IODA_NORMALIZER, buffered: (bytes, context) => runTransformer(IODA_TRANSFORMER, bytes, context) },
});
