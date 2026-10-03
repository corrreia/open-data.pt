import { defineFeed } from "#/catalog/define";
import { DATAVERSE_DEPLOYMENT, DATAVERSE_NORMALIZER, collectIndicator, transformIndicator } from "#/publishers/anacom/dataverse/index";
import { STAT_INDICATOR_POLICY, STAT_STALE_AFTER_SECONDS } from "#/publishers/anacom/dataverse/feeds";
import { ANACOM_ATTRIBUTION } from "#/publishers/anacom/terms";

export const FEED = defineFeed(DATAVERSE_DEPLOYMENT, {
  slug: "anacom-bundle-subscribers",
  title: "Electronic communications subscribers",
  description:
    "Subscribers of electronic communications services in Portugal at the end of each quarter since 2018, bundled and single play: the total, and by bundle size (1P to 4/5P), segment and, for recent quarters, how many mobile cards a bundle includes.",
  licence: "anacom-terms",
  attribution: ANACOM_ATTRIBUTION,
  topics: ["telecom"],
  config: { indicator: "IndI_P008", unit: "subscribers" },
  policy: STAT_INDICATOR_POLICY,
  staleAfterSeconds: STAT_STALE_AFTER_SECONDS,
  /** Once a week: STAT.ANACOM's IndI_P008 file, found by its code in their Dataverse index, inflated and compared with the last one read. */
  fetch: ({ config, validator, library, fetch }) => collectIndicator(config, validator, library.apiOrigin, fetch),
  /** The tab-separated CSV, into one series per breakdown and operator, each value dated by the start of its quarter. */
  transform: { normalizer: DATAVERSE_NORMALIZER, streaming: (body, context) => transformIndicator(body, context) },
});
