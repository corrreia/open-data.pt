import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { USGS_DEPLOYMENT, USGS_NORMALIZER, USGS_TRANSFORMER, collectUsgsFeed } from "#/publishers/usgs/usgs/index";
import { USGS_POLICY } from "#/publishers/usgs/usgs/feeds";

export const FEED = defineFeed(USGS_DEPLOYMENT, {
  slug: "usgs-azores-earthquakes-feed",
  title: "Earthquakes around the Azores",
  description:
    "Earthquakes of magnitude 1 or greater reported by the USGS during the past 30 days in the the Azores bounding region, including source updates and review status. The rectangle may include nearby international waters or Spain.",
  licence: "usgs-public-domain",
  attribution: "U.S. Geological Survey",
  topics: ["environment"],
  config: { feed: "earthquakes", region: "azores", days: "30", minMagnitude: "1" },
  policy: USGS_POLICY,
  staleAfterSeconds: 7200,
  /** Every hour: the USGS catalog's earthquakes of the past 30 days in the bounding box around the Azores. */
  fetch: ({ config, validator, library, fetch, now }) => collectUsgsFeed(config, validator, library.apiOrigin, fetch, now()),
  /** The catalog's GeoJSON, into one record per earthquake. */
  transform: { normalizer: USGS_NORMALIZER, buffered: (bytes, context) => runTransformer(USGS_TRANSFORMER, bytes, context) },
});
