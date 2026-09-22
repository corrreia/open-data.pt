import type { DatasetDefinition, FeedDefinition } from "../../../catalog/define";
import { NASA_POWER_LAG_DAYS, NASA_POWER_MAX_BYTES, NASA_POWER_REGIONS } from "../nasapower";

export const DATASET: DatasetDefinition = {
  title: "NASA POWER solar resource",
  description: "Daily solar irradiance and related weather around mainland Portugal, Madeira and the Azores.",
  licence: "nasa-earthdata",
  attribution: "NASA Prediction Of Worldwide Energy Resources (POWER) Project",
  topics: ["energy", "weather"],
  feeds: [
    regionFeed("nasa-power-mainland-solar-resource-feed", "Daily solar resource around mainland Portugal", "mainland"),
    regionFeed("nasa-power-madeira-solar-resource-feed", "Daily solar resource around Madeira", "madeira"),
    regionFeed("nasa-power-azores-solar-resource-feed", "Daily solar resource around the Azores", "azores"),
  ],
};

function regionFeed(slug: string, title: string, region: keyof typeof NASA_POWER_REGIONS): FeedDefinition {
  return {
    slug,
    title,
    description: `NASA POWER daily all-sky surface shortwave irradiance on its source grid for the ${NASA_POWER_REGIONS[region].name} bounding region, published here after a ${NASA_POWER_LAG_DAYS}-day settling lag. A bounding rectangle may include nearby land or ocean outside Portugal.`,
    config: { source: "nasapower", feed: "daily-region", region, parameter: "ALLSKY_SFC_SW_DWN", days: "30" },
    staleAfterSeconds: 1_209_600,
    policy: {
      name: "NASA POWER daily regional analysis",
      version: 1,
      collection: {
        cadenceSeconds: 604_800,
        timeoutSeconds: 120,
        maxBytes: NASA_POWER_MAX_BYTES,
        maxOutputBytes: 12 * 1024 * 1024,
        maxRecordBytes: 16 * 1024,
        maxRecords: 20_000,
        historyMode: "changes",
      },
    },
  };
}
