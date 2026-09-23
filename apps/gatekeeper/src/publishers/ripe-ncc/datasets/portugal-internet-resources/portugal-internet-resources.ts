import { defineFeed } from "#/catalog/define";
import { RIPESTAT_DEPLOYMENT, RIPESTAT_NORMALIZER, RIPESTAT_TRANSFORMER, collectRipestatFeed } from "#/publishers/ripe-ncc/ripestat/index";
import { RIPESTAT_DAILY_POLICY } from "#/publishers/ripe-ncc/ripestat/feeds";

export const FEED = defineFeed(RIPESTAT_DEPLOYMENT, {
  slug: "ripe-portugal-internet-resources-feed",
  title: "Internet resources registered to Portugal",
  description:
    "RIPEstat's RIR-statistics list of AS numbers and IPv4/IPv6 resources registered to Portugal. Registration country is not physical network geolocation. No per-allocation dates are supplied, and the query snapshot date is not copied onto individual resources.",
  config: { feed: "country-resources", country: "PT" },
  policy: RIPESTAT_DAILY_POLICY,
  staleAfterSeconds: 259_200,
  /** Once a day: RIPEstat's country resource list for Portugal, re-read only when it has changed. */
  fetch: ({ config, state, library, fetch, now }) => collectRipestatFeed(config, state, library.apiOrigin, fetch, { kind: "live" }, now()),
  /** The list, into one record per registered AS number and address block. */
  transform: { normalizer: RIPESTAT_NORMALIZER, streaming: (body, context) => RIPESTAT_TRANSFORMER.transform(body, context) },
});
