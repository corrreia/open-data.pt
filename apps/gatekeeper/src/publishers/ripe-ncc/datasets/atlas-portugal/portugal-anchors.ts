import { defineFeed } from "#/catalog/define";
import { RIPEATLAS_DEPLOYMENT, RIPEATLAS_NORMALIZER, RIPEATLAS_TRANSFORMER, collectRipeatlasFeed } from "#/publishers/ripe-ncc/ripeatlas/index";

export const FEED = defineFeed(RIPEATLAS_DEPLOYMENT, {
  slug: "ripe-atlas-portugal-anchors-feed",
  title: "RIPE Atlas anchors in Portugal",
  description:
    "RIPE Atlas anchors installed in Portugal, by the public hostname RIPE publishes in DNS, the city that hostname already names, the anchor's IPv4/IPv6 AS numbers, whether it is disabled or a replacement, its hardware version, and the dates it went live and was decommissioned. The host organisation or person, their RIPE NIC handle, the anchor's addresses and gateways and its exact coordinates are deliberately excluded. This is an inventory of measurement infrastructure, not a report on any network's performance.",
  config: { feed: "country-anchors", country: "PT" },
  policy: {
    name: "RIPE Atlas research — republication permission required",
    version: 1,
    // Weekly: under ten anchors, changing perhaps once or twice a year.
    collection: {
      cadenceSeconds: 604_800,
      timeoutSeconds: 60,
      maxBytes: 2 * 1024 * 1024,
      maxOutputBytes: 4 * 1024 * 1024,
      maxRecordBytes: 16 * 1024,
      maxRecords: 100,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 1_814_400,
  /** Once a week: every page of RIPE Atlas's anchors in Portugal. */
  fetch: ({ config, library, fetch }) => collectRipeatlasFeed(config, library.apiOrigin, fetch),
  /** The anchors, into one record per anchor, without its host, addresses or exact position. */
  transform: { normalizer: RIPEATLAS_NORMALIZER, streaming: (body, context) => RIPEATLAS_TRANSFORMER.transform(body, context) },
});
