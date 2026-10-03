import { defineFeed } from "#/catalog/define";
import { DATAVERSE_DEPLOYMENT, DATAVERSE_NORMALIZER, collectIndicator, transformIndicator } from "#/publishers/anacom/dataverse/index";
import { STAT_INDICATOR_POLICY, STAT_STALE_AFTER_SECONDS } from "#/publishers/anacom/dataverse/feeds";
import { ANACOM_ATTRIBUTION } from "#/publishers/anacom/terms";

export const FEED = defineFeed(DATAVERSE_DEPLOYMENT, {
  slug: "anacom-mobile-data-traffic",
  title: "Mobile data traffic",
  description:
    "Mobile data traffic in Portugal each quarter since 2018, in gigabytes: the total, and by network generation (2G/3G, 4G, 5G), segment, device (mobile phone or PC, tablet, pen and router) and whether it was internet access.",
  licence: "anacom-terms",
  attribution: ANACOM_ATTRIBUTION,
  topics: ["telecom"],
  config: { indicator: "IndI_P087", unit: "GB" },
  policy: STAT_INDICATOR_POLICY,
  staleAfterSeconds: STAT_STALE_AFTER_SECONDS,
  /** Once a week: STAT.ANACOM's IndI_P087 file, found by its code in their Dataverse index, inflated and compared with the last one read. */
  fetch: ({ config, validator, library, fetch }) => collectIndicator(config, validator, library.apiOrigin, fetch),
  /** The tab-separated CSV, into one series per breakdown and operator, each value dated by the start of its quarter. */
  transform: { normalizer: DATAVERSE_NORMALIZER, streaming: (body, context) => transformIndicator(body, context) },
});
