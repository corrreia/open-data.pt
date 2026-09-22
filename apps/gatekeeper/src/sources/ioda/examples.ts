import type { ExampleFeed, SourceConfig } from "../../index";
import { IODA_MAX_BYTES, IODA_PAGE_LIMIT, IODA_PORTUGUESE_ASNS } from "./ioda";

/**
 * IODA detects an outage in ten-minute bins, so a quarter of an hour keeps the
 * event log within about one bin of the source while asking for a two-kilobyte
 * answer ninety-six times a day.
 */
const OUTAGE_CADENCE_SECONDS = 900;
/**
 * Signals move in five- and ten-minute steps, but a connectivity series is
 * context rather than an alarm — the event log above is what answers "is
 * something wrong right now". One collection an hour over a three-hour window
 * republishes two hours already published, which is what picks up a bin IODA
 * filled in or corrected late; unchanged points cost the kernel no history.
 */
const SIGNAL_CADENCE_SECONDS = 3600;

export const IODA_EXAMPLES: ExampleFeed[] = [
  example(
    "ioda-portugal-internet-outages-feed",
    "Internet outages detected in Portugal",
    "Every internet outage IODA detected for Portugal in the past week: when it started, how long it lasted, which measurement source and detection method saw it, and how far the country fell below its own normal. Academic detection from BGP, active probing, network telescope and Google traffic, not an operator's incident report, and an outage no measurement source saw is not in it.",
    { feed: "outage-events", entityType: "country", entityCode: "PT", days: "7" },
    OUTAGE_CADENCE_SECONDS,
  ),
  example(
    "ioda-portugal-internet-outage-alerts-feed",
    "Internet outage alert levels for Portugal",
    "The per-bin alerts behind IODA's Portuguese outage events: the level each datasource crossed, the condition it crossed, the value measured and the historical value it was compared against. More granular and noisier than the outage log, and a 'normal' record is the end of an alert, not a new incident.",
    { feed: "outage-alerts", entityType: "country", entityCode: "PT", days: "7" },
    OUTAGE_CADENCE_SECONDS,
  ),
  network("ioda-meo-as3243-internet-signals-feed", "MEO AS3243 internet connectivity signals", "3243"),
  network("ioda-nos-as2860-internet-signals-feed", "NOS AS2860 internet connectivity signals", "2860"),
  network("ioda-vodafone-as12353-internet-signals-feed", "Vodafone Portugal AS12353 internet connectivity signals", "12353"),
  network("ioda-digi-pt-as20879-internet-signals-feed", "DIGI Portugal AS20879 internet connectivity signals", "20879"),
  network("ioda-nos-madeira-as15457-internet-signals-feed", "NOS Madeira AS15457 internet connectivity signals", "15457"),
  example(
    "ioda-portugal-internet-signals-feed",
    "Portugal internet connectivity signals",
    "IODA's country-wide connectivity measurements for Portugal: /24 blocks visible in BGP, /24 blocks answering active probes, unique source IPs reaching the Merit network telescope, and normalized Google traffic. Country totals, which are not the sum of the per-network feeds and cover networks those five do not. Not a speed, quality or customer-availability report.",
    { feed: "signals", entityType: "country", entityCode: "PT", hours: "3" },
    SIGNAL_CADENCE_SECONDS,
  ),
];

/** One Portuguese network's signals, named with the holder IODA itself returns for that AS. */
function network(slug: string, title: string, asn: string): ExampleFeed {
  const holder = IODA_PORTUGUESE_ASNS.get(asn) ?? asn;
  return example(
    slug,
    title,
    `IODA's connectivity measurements for AS${asn}, whose holder IODA reports as ${holder}: /24 blocks visible in BGP, /24 blocks answering active probes, and unique source IPs reaching the Merit network telescope. This one AS is not every network the operator runs, and a measurement gap is left out rather than published as a zero. Not a speed, quality or customer-availability report.`,
    { feed: "signals", entityType: "asn", entityCode: asn, hours: "3" },
    SIGNAL_CADENCE_SECONDS,
  );
}

function example(slug: string, title: string, description: string, config: SourceConfig, cadenceSeconds: number): ExampleFeed {
  return {
    slug,
    dataset: "ioda-portugal-internet-outages",
    title,
    description,
    config: { source: "ioda", ...config },
    staleAfterSeconds: cadenceSeconds * 3,
    policy: {
      name: "IODA measurement — republication permission required",
      version: 1,
      collection: {
        cadenceSeconds,
        timeoutSeconds: 60,
        maxBytes: IODA_MAX_BYTES,
        maxOutputBytes: 4 * IODA_MAX_BYTES,
        maxRecordBytes: 16 * 1024,
        maxRecords: config.feed === "signals" ? 5000 : IODA_PAGE_LIMIT,
        // One product per feed, and every change to an outage's duration or a
        // corrected signal point is worth keeping.
        historyMode: "changes",
      },
    },
  };
}
