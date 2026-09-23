import { defineFeed } from "#/catalog/define";
import { runTransformer } from "#/index";
import { NASA_POWER_DEPLOYMENT, NASA_POWER_NORMALIZER, NASA_POWER_TRANSFORMER, collectNasaPowerFeed } from "#/publishers/nasa-power/nasapower/index";
import { NASA_POWER_POLICY } from "#/publishers/nasa-power/nasapower/feeds";

export const FEED = defineFeed(NASA_POWER_DEPLOYMENT, {
  slug: "nasa-power-azores-solar-resource-feed",
  title: "Daily solar resource around the Azores",
  description:
    "NASA POWER daily all-sky surface shortwave irradiance on its source grid for the the Azores bounding region, published here after a 90-day settling lag. A bounding rectangle may include nearby land or ocean outside Portugal.",
  config: { feed: "daily-region", region: "azores", parameter: "ALLSKY_SFC_SW_DWN", days: "30" },
  policy: NASA_POWER_POLICY,
  staleAfterSeconds: 1_209_600,
  /** Once a week: POWER's daily regional analysis of the last 30 settled days over the bounding box around the Azores. */
  fetch: ({ config, validator, library, fetch, now }) => collectNasaPowerFeed(config, validator, library.apiOrigin, fetch, now()),
  /** POWER's regional JSON, into one daily series per grid point. */
  transform: { normalizer: NASA_POWER_NORMALIZER, buffered: (bytes, context) => runTransformer(NASA_POWER_TRANSFORMER, bytes, context) },
});
