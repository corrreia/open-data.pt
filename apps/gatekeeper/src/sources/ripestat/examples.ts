import type { ExampleFeed, SourceConfig } from "../../index";

/** Do not auto-install for public republication without RIPE NCC permission: service terms Article 3.3. */
export const RIPESTAT_EXAMPLES: ExampleFeed[] = [
  example(
    "ripe-portugal-internet-resources-feed",
    "Internet resources registered to Portugal",
    "RIPEstat's RIR-statistics list of AS numbers and IPv4/IPv6 resources registered to Portugal. Registration country is not physical network geolocation. No per-allocation dates are supplied, and the query snapshot date is not copied onto individual resources.",
    { feed: "country-resources", country: "PT" },
    86_400,
  ),
  example(
    "ripe-portugal-routing-history-feed",
    "Portugal internet routing observations",
    "The preceding thirty completed UTC days of daily RIS-announced IPv4/IPv6 prefix and ASN counts, plus RIR registered-ASN counts, for Portugal. Prefix counts are not address counts. Unavailable negative sentinels are not measurements. This is routing/registration research data, not customer service availability.",
    { feed: "country-routing", country: "PT", days: "30" },
    86_400,
  ),
  network("ripe-meo-as3243-routing-feed", "MEO residential AS3243 routing snapshot", "3243", "MEO-RESIDENCIAL MEO - SERVICOS DE COMUNICACOES E MULTIMEDIA S.A."),
  network("ripe-nos-as2860-routing-feed", "NOS AS2860 routing snapshot", "2860", "NOS_COMUNICACOES NOS COMUNICACOES, S.A."),
  network("ripe-vodafone-as12353-routing-feed", "Vodafone Portugal AS12353 routing snapshot", "12353", "VODAFONE-PT Vodafone Portugal - Communicacoes Pessoais S.A."),
  network("ripe-digi-pt-as20879-routing-feed", "DIGI-PT AS20879 routing snapshot", "20879", "DIGI-PT DIGI ROMANIA S.A."),
  network("ripe-nos-madeira-as15457-routing-feed", "NOS Madeira AS15457 routing snapshot", "15457", "NOS_MADEIRA NOS Madeira Comunicacoes, S.A."),
];

function network(slug: string, title: string, asn: string, holder: string): ExampleFeed {
  return example(
    slug,
    title,
    `RIPE RIS routing snapshot for AS${asn}; holder verified through RIPE as-overview as ${holder}. This one AS does not represent every network of the operator or exclusively Portuguese routes. Visibility uses the ten-full-feed-peer threshold and IPv6 space is measured in /48 subnet equivalents, not individual addresses. RIPE's snapshots are at 00:00, 08:00 and 16:00 UTC; this is not an ISP outage, speed or customer-availability report.`,
    { feed: "routing-status", asn },
    28_800,
  );
}

function example(slug: string, title: string, description: string, config: SourceConfig, cadenceSeconds: number): ExampleFeed {
  return {
    slug,
    dataset: "ripe-ncc-portugal-internet-resources",
    title,
    description,
    config: { source: "ripestat", ...config },
    staleAfterSeconds: cadenceSeconds * 3,
    policy: {
      name: "RIPEstat research — republication permission required",
      version: 1,
      collection: {
        cadenceSeconds,
        timeoutSeconds: 60,
        maxBytes: 1024 * 1024,
        maxOutputBytes: 2 * 1024 * 1024,
        maxRecordBytes: 16 * 1024,
        maxRecords: 5000,
        historyMode: "changes",
      },
    },
  };
}
