import { defineFeed } from "#/catalog/define";
import { RIPESTAT_DEPLOYMENT, RIPESTAT_NORMALIZER, RIPESTAT_TRANSFORMER, collectRipestatFeed } from "#/publishers/ripe-ncc/ripestat/index";
import { RIPESTAT_DAILY_POLICY } from "#/publishers/ripe-ncc/ripestat/feeds";

export const FEED = defineFeed(RIPESTAT_DEPLOYMENT, {
  slug: "ripe-portugal-routing-history-feed",
  title: "Portugal internet routing observations",
  description:
    "The preceding thirty completed UTC days of daily RIS-announced IPv4/IPv6 prefix and ASN counts, plus RIR registered-ASN counts, for Portugal. Prefix counts are not address counts. Unavailable negative sentinels are not measurements. This is routing/registration research data, not customer service availability.",
  config: { feed: "country-routing", country: "PT", days: "30" },
  policy: RIPESTAT_DAILY_POLICY,
  staleAfterSeconds: 259_200,
  /** Once a day: RIPEstat's daily country routing statistics for Portugal over the thirty completed UTC days before today, re-read only when it has changed. */
  fetch: ({ config, state, library, fetch, now }) => collectRipestatFeed(config, state, library.apiOrigin, fetch, { kind: "live" }, now()),
  /** Once, walking back: the same statistics for the thirty days before the cursor, until RIPEstat has nothing older. */
  backfill: ({ config, state, library, fetch, now }, cursor) => collectRipestatFeed(config, state, library.apiOrigin, fetch, { kind: "history", cursor }, now()),
  /** The daily statistics, into one series per count. */
  transform: { normalizer: RIPESTAT_NORMALIZER, streaming: (body, context) => RIPESTAT_TRANSFORMER.transform(body, context) },
});
