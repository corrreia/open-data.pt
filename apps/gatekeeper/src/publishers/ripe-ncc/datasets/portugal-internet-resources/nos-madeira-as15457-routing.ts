import { defineFeed } from "#/catalog/define";
import { RIPESTAT_DEPLOYMENT, RIPESTAT_NORMALIZER, RIPESTAT_TRANSFORMER, collectRipestatFeed } from "#/publishers/ripe-ncc/ripestat/index";
import { RIPESTAT_ROUTING_STATUS_POLICY } from "#/publishers/ripe-ncc/ripestat/feeds";

export const FEED = defineFeed(RIPESTAT_DEPLOYMENT, {
  slug: "ripe-nos-madeira-as15457-routing-feed",
  title: "NOS Madeira AS15457 routing snapshot",
  description:
    "RIPE RIS routing snapshot for AS15457; holder verified through RIPE as-overview as NOS_MADEIRA NOS Madeira Comunicacoes, S.A.. This one AS does not represent every network of the operator or exclusively Portuguese routes. Visibility uses the ten-full-feed-peer threshold and IPv6 space is measured in /48 subnet equivalents, not individual addresses. RIPE's snapshots are at 00:00, 08:00 and 16:00 UTC; this is not an ISP outage, speed or customer-availability report.",
  config: { feed: "routing-status", asn: "15457" },
  policy: RIPESTAT_ROUTING_STATUS_POLICY,
  staleAfterSeconds: 86_400,
  /** Every eight hours: RIPEstat's latest routing status for AS15457, seen by at least ten full-feed peers, re-read only when it has changed. */
  fetch: ({ config, state, library, fetch, now }) => collectRipestatFeed(config, state, library.apiOrigin, fetch, { kind: "live" }, now()),
  /** The status, into the AS's current routing snapshot. */
  transform: { normalizer: RIPESTAT_NORMALIZER, streaming: (body, context) => RIPESTAT_TRANSFORMER.transform(body, context) },
});
