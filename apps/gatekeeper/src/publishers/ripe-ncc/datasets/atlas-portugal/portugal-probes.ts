import { defineFeed } from "#/catalog/define";
import { RIPEATLAS_DEPLOYMENT, RIPEATLAS_NORMALIZER, RIPEATLAS_TRANSFORMER, collectRipeatlasFeed } from "#/publishers/ripe-ncc/ripeatlas/index";

export const FEED = defineFeed(RIPEATLAS_DEPLOYMENT, {
  slug: "ripe-atlas-portugal-probes-feed",
  title: "RIPE Atlas measurement probes in Portugal",
  description:
    "Public RIPE Atlas probes registered in Portugal that are connected, disconnected or not yet connected: probe ID, the AS and announced prefix the probe sits behind, whether it is an anchor, its connection state and since when, when it first connected, and the host-chosen connection tags. Nothing that identifies a host is included: no probe IP addresses, no host-written description, and no coordinates, which RIPE Atlas publishes only with a random 80-400 m offset anyway. Probes whose host opted out of being indexed are excluded, and RIPE's own system-* tags are dropped because they flip with a probe's DNS behaviour rather than describing it.",
  config: { feed: "country-probes", country: "PT" },
  policy: {
    name: "RIPE Atlas research — republication permission required",
    version: 1,
    // Daily: a fleet of roughly a hundred probes gains or loses a handful a week, the API
    // sends no ETag so every collection re-reads every row, and RIPE asks clients to cache
    // rather than poll tightly.
    collection: {
      cadenceSeconds: 86_400,
      timeoutSeconds: 60,
      maxBytes: 2 * 1024 * 1024,
      maxOutputBytes: 4 * 1024 * 1024,
      maxRecordBytes: 16 * 1024,
      maxRecords: 1000,
      historyMode: "changes",
    },
  },
  staleAfterSeconds: 259_200,
  /** Once a day: every page of RIPE Atlas's public probes in Portugal. */
  fetch: ({ config, library, fetch }) => collectRipeatlasFeed(config, library.apiOrigin, fetch),
  /** The probes, into one record per probe, without anything that identifies its host. */
  transform: { normalizer: RIPEATLAS_NORMALIZER, streaming: (body, context) => RIPEATLAS_TRANSFORMER.transform(body, context) },
});
