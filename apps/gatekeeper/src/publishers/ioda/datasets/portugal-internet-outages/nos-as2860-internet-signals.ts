import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { IODA_DEPLOYMENT, IODA_NORMALIZER, IODA_TRANSFORMER, collectIodaFeed } from "#/publishers/ioda/ioda/index";
import { IODA_SIGNAL_POLICY } from "#/publishers/ioda/ioda/feeds";

export const FEED = defineFeed(IODA_DEPLOYMENT, {
  slug: "ioda-nos-as2860-internet-signals-feed",
  title: "NOS AS2860 internet connectivity signals",
  description:
    "IODA's connectivity measurements for AS2860, whose holder IODA reports as NOS_COMUNICACOES: /24 blocks visible in BGP, /24 blocks answering active probes, and unique source IPs reaching the Merit network telescope. This one AS is not every network the operator runs, and a measurement gap is left out rather than published as a zero. Not a speed, quality or customer-availability report.",
  config: { feed: "signals", entityType: "asn", entityCode: "2860", hours: "3" },
  policy: IODA_SIGNAL_POLICY,
  staleAfterSeconds: 10_800,
  /** Every hour: IODA's raw connectivity signals for AS2860 over the past three hours. */
  fetch: ({ config, library, fetch, now }) => collectIodaFeed(config, library.hosts, fetch, { kind: "live" }, now()),
  /** The signals, into one series per datasource, leaving a measurement gap out rather than publishing a zero. */
  transform: { normalizer: IODA_NORMALIZER, buffered: (bytes, context) => runTransformer(IODA_TRANSFORMER, bytes, context) },
});
