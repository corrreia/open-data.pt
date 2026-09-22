import type { ExampleFeed } from "../../index";
import { NASA_POWER_LAG_DAYS, NASA_POWER_MAX_BYTES, NASA_POWER_REGIONS } from "./nasapower";

export const NASA_POWER_EXAMPLES: ExampleFeed[] = [
  example("nasa-power-mainland-solar-resource-feed", "Daily solar resource around mainland Portugal", "mainland"),
  example("nasa-power-madeira-solar-resource-feed", "Daily solar resource around Madeira", "madeira"),
  example("nasa-power-azores-solar-resource-feed", "Daily solar resource around the Azores", "azores"),
];

function example(slug: string, title: string, region: keyof typeof NASA_POWER_REGIONS): ExampleFeed {
  return {
    slug,
    dataset: "nasa-power-portugal-solar-resource",
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
