import { defineFeed } from "#/catalog/define";
import { FIRMS_DEPLOYMENT, FIRMS_NORMALIZER, FIRMS_TRANSFORMER, collectFirmsFeed } from "#/publishers/nasa-firms/firms/index";
import { FIRMS_POLICY } from "#/publishers/nasa-firms/firms/feeds";

export const FEED = defineFeed(FIRMS_DEPLOYMENT, {
  slug: "nasa-firms-azores-thermal-anomalies-feed",
  title: "NASA FIRMS thermal anomalies around the Azores",
  description:
    "VIIRS Suomi-NPP near-real-time thermal-anomaly pixels detected during the past 5 days in the the Azores bounding region. A pixel is not a confirmed wildfire, exact ignition point or burnt-area perimeter.",
  config: { feed: "hotspots", region: "azores", product: "VIIRS_SNPP_NRT" },
  policy: FIRMS_POLICY,
  staleAfterSeconds: 21_600,
  /** Every three hours: FIRMS's area CSV of VIIRS Suomi-NPP pixels over the past days in the bounding box around the Azores, asked with the map key. */
  fetch: ({ config, library, fetch }) => collectFirmsFeed(config, library.apiOrigin, library.mapKey, fetch),
  /** The CSV, row by row, into one record per thermal-anomaly pixel. */
  transform: { normalizer: FIRMS_NORMALIZER, streaming: (body, context) => FIRMS_TRANSFORMER.transform(body, context) },
});
