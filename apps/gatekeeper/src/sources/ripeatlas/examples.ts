import type { ExampleFeed, SourceConfig } from "../../index";

/**
 * RIPE Atlas data is not openly licensed, whatever "open data" articles about it
 * say. The RIPE NCC Terms of Service Article 3.5 read "The User shall not
 * re-package, download, compile, re-distribute or re-Use any or all of the data
 * contained on the Website or on any Publicly Available RIPE NCC Service, unless
 * this is permitted as part of their Use of the Website or the particular
 * Publicly Available RIPE NCC Service"; the RIPE Atlas Service Terms and
 * Conditions v3.5 Article 4.5 add that "Any commercial use of the RIPE Atlas
 * Data is subject to prior permission by the RIPE NCC", and Article 10.2 that
 * RIPE NCC databases "may only be used, reproduced and made available to third
 * parties upon prior written authorisation from the RIPE NCC". No Creative
 * Commons grant exists for probe metadata or measurement results. Do not
 * auto-install for public republication without that permission, exactly as for
 * RIPEstat.
 */
export const RIPEATLAS_EXAMPLES: ExampleFeed[] = [
  example(
    "ripe-atlas-portugal-probes-feed",
    "RIPE Atlas measurement probes in Portugal",
    "Public RIPE Atlas probes registered in Portugal that are connected, disconnected or not yet connected: probe ID, the AS and announced prefix the probe sits behind, whether it is an anchor, its connection state and since when, when it first connected, and the host-chosen connection tags. Nothing that identifies a host is included: no probe IP addresses, no host-written description, and no coordinates, which RIPE Atlas publishes only with a random 80-400 m offset anyway. Probes whose host opted out of being indexed are excluded, and RIPE's own system-* tags are dropped because they flip with a probe's DNS behaviour rather than describing it.",
    { feed: "country-probes", country: "PT" },
    // Daily: a fleet of roughly a hundred probes gains or loses a handful a week, the API
    // sends no ETag so every collection re-reads every row, and RIPE asks clients to cache
    // rather than poll tightly.
    86_400,
    1000,
  ),
  example(
    "ripe-atlas-portugal-anchors-feed",
    "RIPE Atlas anchors in Portugal",
    "RIPE Atlas anchors installed in Portugal, by the public hostname RIPE publishes in DNS, the city that hostname already names, the anchor's IPv4/IPv6 AS numbers, whether it is disabled or a replacement, its hardware version, and the dates it went live and was decommissioned. The host organisation or person, their RIPE NIC handle, the anchor's addresses and gateways and its exact coordinates are deliberately excluded. This is an inventory of measurement infrastructure, not a report on any network's performance.",
    { feed: "country-anchors", country: "PT" },
    // Weekly: under ten anchors, changing perhaps once or twice a year.
    604_800,
    100,
  ),
];

function example(slug: string, title: string, description: string, config: SourceConfig, cadenceSeconds: number, maxRecords: number): ExampleFeed {
  return {
    slug,
    dataset: "ripe-ncc-atlas-portugal",
    title,
    description,
    config: { source: "ripeatlas", ...config },
    staleAfterSeconds: cadenceSeconds * 3,
    policy: {
      name: "RIPE Atlas research — republication permission required",
      version: 1,
      collection: {
        cadenceSeconds,
        timeoutSeconds: 60,
        maxBytes: 2 * 1024 * 1024,
        maxOutputBytes: 4 * 1024 * 1024,
        maxRecordBytes: 16 * 1024,
        maxRecords,
        historyMode: "changes",
      },
    },
  };
}
